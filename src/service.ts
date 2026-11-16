/**
 * The refill lifecycle:
 *
 *   reportEmpty ─► awaiting_buyer ─accept─► committed ─submitReceipt─► purchased ─► claim_submitted ─► reimbursed
 *                    │   ▲  decline / offer timeout          │ release /            │ over cap             └─► claim_rejected
 *                    │   └─ (next volunteer, or open call) ◄─┘ purchase timeout     ▼
 *                    ▼                                                         needs_approval ─approve─► purchased
 *              on_hold_budget (resumes when the month's budget allows)
 *
 * Chat button handlers call the public methods; a scheduler calls `tick` every
 * few minutes to apply timeouts, retry HR submissions and poll claim status.
 * Every change is a read, check, then conditional write (see repository.ts),
 * and chat messages are only sent after the write succeeds.
 */

import { budgetPosition, spendCap } from "./budget.ts";
import {
  ACTIVE_STATES, AlreadyTaken, InvalidState, localDay, localMonth, newRefill, NotAllowed, RefillError,
  type Office, type Refill, type Volunteer,
} from "./domain.ts";
import type { Money } from "./money.ts";
import type { Calendar, Chat, Clock, HrSystem } from "./ports.ts";
import { ConcurrentModification, type InMemoryRefillRepository } from "./repository.ts";
import { chooseBuyer } from "./selection.ts";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface Policy {
  offerTtlMs: number;            // time to accept or decline an offer
  purchaseTtlMs: number;         // time from accepting to uploading the receipt
  openCallRetryMs: number;       // how often an unclaimed open call is retried / re-posted
  claimRetryMs: number;          // wait before retrying a failed HR submission
  hrSlaMs: number;               // HR's stated maximum approval time
  hrReminderIntervalMs: number;  // how often to remind the coordinator once past the SLA
}

export const DEFAULT_POLICY: Policy = {
  offerTtlMs: 2 * HOUR,
  purchaseTtlMs: 24 * HOUR,
  openCallRetryMs: 4 * HOUR,
  claimRetryMs: 15 * MINUTE,
  hrSlaMs: 10 * DAY,
  hrReminderIntervalMs: 1 * DAY,
};

export interface Receipt {
  amount: Money;
  receiptImage: Uint8Array;
  items: string[];
}

export interface ServiceDeps {
  offices: Office[];
  volunteers: Volunteer[];
  repo: InMemoryRefillRepository;
  chat: Chat;
  hr: HrSystem;
  calendar: Calendar;
  clock: Clock;
  policy?: Policy;
}

interface Notice {
  kind: "direct" | "channel";
  to: string;
  text: string;
}

/** Returns the messages to send once the change is saved, or null if nothing changed. */
type Change = (r: Refill, all: Refill[], now: Date) => Promise<Notice[] | null>;

const dm = (to: string, text: string): Notice => ({ kind: "direct", to, text });
const post = (officeId: string, text: string): Notice => ({ kind: "channel", to: officeId, text });
const due = (at: Date | null, now: Date) => at !== null && at.getTime() <= now.getTime();
const later = (now: Date, ms: number) => new Date(now.getTime() + ms);
const others = (all: Refill[], r: Refill) => all.filter((x) => x.id !== r.id);

export class RefillService {
  private readonly offices: Map<string, Office>;
  private readonly volunteers: Map<string, Volunteer>;
  private readonly repo: InMemoryRefillRepository;
  private readonly chat: Chat;
  private readonly hr: HrSystem;
  private readonly calendar: Calendar;
  private readonly clock: Clock;
  private readonly policy: Policy;
  private nextId = 1;

  constructor(deps: ServiceDeps) {
    this.offices = new Map(deps.offices.map((o) => [o.id, o]));
    this.volunteers = new Map(deps.volunteers.map((v) => [v.id, v]));
    this.repo = deps.repo;
    this.chat = deps.chat;
    this.hr = deps.hr;
    this.calendar = deps.calendar;
    this.clock = deps.clock;
    this.policy = deps.policy ?? DEFAULT_POLICY;
  }

  // ── commands from chat ────────────────────────────────────────────────

  /** Anyone can report an empty box. A second report while one is open returns the open refill. */
  async reportEmpty(officeId: string, reporterId: string): Promise<Refill> {
    const office = this.office(officeId);
    const now = this.clock.now();
    const all = await this.repo.all();
    const open = all.find((r) => r.officeId === office.id && ACTIVE_STATES.has(r.state));
    if (open) return this.alreadyHandled(open, reporterId);

    const draft = newRefill(`R-${String(this.nextId++).padStart(4, "0")}`, office.id, reporterId, now);
    const notices = await this.findBuyer(draft, all, now);
    const { refill, created } = await this.repo.addIfNoneActive(draft);
    if (!created) return this.alreadyHandled(refill, reporterId);
    await this.send(notices);
    return refill;
  }

  async accept(refillId: string, volunteerId: string): Promise<Refill> {
    const v = this.volunteer(volunteerId);
    return this.update(refillId, async (r, all, now) => {
      if (r.state === "on_hold_budget") throw new InvalidState(`refill ${r.id} is on hold: budget used up`);
      if (r.state !== "awaiting_buyer") throw new AlreadyTaken(`refill ${r.id} is already taken`);
      if (r.offeredTo !== null && r.offeredTo !== v.id) throw new NotAllowed(`refill ${r.id} is offered to someone else`);

      const office = this.office(r.officeId);
      const cap = spendCap(office, others(all, r), localMonth(now, office.timeZone));
      if (!cap) return this.findBuyer(r, all, now); // budget ran out meanwhile: puts it on hold

      Object.assign(r, {
        state: "committed", buyerId: v.id, committedAt: now, purchaseDueAt: later(now, this.policy.purchaseTtlMs),
        spendCap: cap, offeredTo: null, offerExpiresAt: null, openCallRetryAt: null,
      });
      r.history.push({ at: now, event: `${v.id} committed, cap ${cap}` });
      return [
        dm(v.id, `Thanks! You're refilling the ${office.name} box. Spend up to ${cap} and upload the receipt within ${this.hours(this.policy.purchaseTtlMs)} hours; the claim goes to HR automatically.`),
        post(office.id, `${v.name} is refilling the snack box. No one else needs to buy.`),
      ];
    });
  }

  async decline(refillId: string, volunteerId: string): Promise<Refill> {
    return this.update(refillId, async (r, all, now) => {
      if (r.state !== "awaiting_buyer" || r.offeredTo !== volunteerId) {
        throw new NotAllowed(`refill ${r.id} is not offered to ${volunteerId}`);
      }
      this.passOver(r, volunteerId, now, "declined");
      return this.findBuyer(r, all, now);
    });
  }

  /** The buyer can't make it after all. */
  async release(refillId: string, volunteerId: string): Promise<Refill> {
    return this.update(refillId, async (r, all, now) => {
      if (r.state !== "committed" || r.buyerId !== volunteerId) {
        throw new NotAllowed(`refill ${r.id} is not committed to ${volunteerId}`);
      }
      this.unassign(r, now, "released it");
      return this.findBuyer(r, all, now);
    });
  }

  async submitReceipt(refillId: string, volunteerId: string, receipt: Receipt): Promise<Refill> {
    const refill = await this.update(refillId, async (r, _all, now) => {
      if (r.buyerId !== volunteerId) throw new NotAllowed(`refill ${r.id} is not assigned to ${volunteerId}`);
      if (r.state !== "committed") throw new InvalidState(`refill ${r.id} is ${r.state}`);
      const office = this.office(r.officeId);
      if (receipt.amount.currency !== office.currency) {
        throw new RefillError(`receipt for the ${office.name} counter must be in ${office.currency}`);
      }
      if (!receipt.amount.isPositive()) throw new RefillError("amount must be positive");
      if (receipt.receiptImage.length === 0) throw new RefillError("a receipt image is required");

      Object.assign(r, { amount: receipt.amount, purchasedAt: now, items: [...receipt.items], receiptImage: receipt.receiptImage });
      const buyer = this.volunteer(volunteerId);
      const notices = [post(office.id, `The snack box has been refilled by ${buyer.name}. Thanks!`)];
      if (receipt.amount.greaterThan(r.spendCap!)) {
        r.state = "needs_approval";
        r.history.push({ at: now, event: `receipt ${receipt.amount} is above cap ${r.spendCap}` });
        notices.push(
          dm(office.coordinatorId, `${buyer.name} spent ${receipt.amount} on refill ${r.id}, above the agreed ${r.spendCap}. Please approve it so the claim can go to HR.`),
          dm(buyer.id, `Your receipt is above the agreed ${r.spendCap}, so the office coordinator needs to approve it before it goes to HR.`),
        );
      } else {
        r.state = "purchased";
        r.claimRetryAt = now;
        r.history.push({ at: now, event: `receipt ${receipt.amount}` });
      }
      return notices;
    });
    return refill.state === "purchased" ? this.submitClaim(refill.id) : refill;
  }

  async approvePurchase(refillId: string, approverId: string): Promise<Refill> {
    await this.update(refillId, async (r, _all, now) => {
      if (approverId !== this.office(r.officeId).coordinatorId) throw new NotAllowed("only the office coordinator can approve");
      if (r.state !== "needs_approval") throw new InvalidState(`refill ${r.id} is ${r.state}`);
      r.state = "purchased";
      r.claimRetryAt = now;
      r.history.push({ at: now, event: `over-cap receipt approved by ${approverId}` });
      return [dm(r.buyerId!, `Your receipt for refill ${r.id} was approved and is being sent to HR.`)];
    });
    return this.submitClaim(refillId);
  }

  // ── scheduler ─────────────────────────────────────────────────────────

  async tick(): Promise<void> {
    const now = this.clock.now();
    for (const r of await this.repo.all()) {
      if (r.state === "awaiting_buyer" && r.offeredTo && due(r.offerExpiresAt, now)) await this.expireOffer(r.id);
      else if (r.state === "awaiting_buyer" && !r.offeredTo && due(r.openCallRetryAt, now)) await this.retrySearch(r.id);
      else if (r.state === "committed" && due(r.purchaseDueAt, now)) await this.expireCommitment(r.id);
      else if (r.state === "on_hold_budget") await this.retrySearch(r.id);
      else if (r.state === "purchased" && due(r.claimRetryAt, now)) await this.submitClaim(r.id);
      else if (r.state === "claim_submitted") await this.checkClaim(r.id);
    }
  }

  private expireOffer(refillId: string): Promise<Refill> {
    return this.update(refillId, async (r, all, now) => {
      if (r.state !== "awaiting_buyer" || !r.offeredTo || !due(r.offerExpiresAt, now)) return null;
      const who = r.offeredTo;
      this.passOver(r, who, now, "did not answer in time");
      const office = this.office(r.officeId);
      return [dm(who, `No problem, the ${office.name} refill has been passed to someone else.`), ...(await this.findBuyer(r, all, now))];
    });
  }

  private expireCommitment(refillId: string): Promise<Refill> {
    return this.update(refillId, async (r, all, now) => {
      if (r.state !== "committed" || !due(r.purchaseDueAt, now)) return null;
      const who = r.buyerId!;
      this.unassign(r, now, "did not upload a receipt in time");
      const office = this.office(r.officeId);
      return [
        dm(who, `No receipt arrived within ${this.hours(this.policy.purchaseTtlMs)} hours, so the ${office.name} refill has been passed to someone else. If you already bought snacks, please contact the office coordinator.`),
        ...(await this.findBuyer(r, all, now)),
      ];
    });
  }

  /** Re-runs selection for an open call (people may have arrived) or a budget hold (a new month may have started). */
  private retrySearch(refillId: string): Promise<Refill> {
    return this.update(refillId, async (r, all, now) => {
      if (r.state === "awaiting_buyer" && !r.offeredTo && due(r.openCallRetryAt, now)) return this.findBuyer(r, all, now);
      if (r.state === "on_hold_budget") {
        const office = this.office(r.officeId);
        if (!spendCap(office, others(all, r), localMonth(now, office.timeZone))) return null;
        return this.findBuyer(r, all, now);
      }
      return null;
    });
  }

  private async submitClaim(refillId: string): Promise<Refill> {
    // Take a short lease first, so a concurrent tick can't send the same claim twice.
    let leased = false;
    const r = await this.update(refillId, async (r, _all, now) => {
      leased = r.state === "purchased" && due(r.claimRetryAt, now);
      if (!leased) return null;
      r.claimRetryAt = later(now, this.policy.claimRetryMs);
      return [];
    });
    if (!leased) return r;

    const office = this.office(r.officeId);
    let claimId: string;
    try {
      claimId = await this.hr.createClaim({
        employeeId: r.buyerId!,
        amount: r.amount!,
        description: `Snack refill ${r.id} for the ${office.name} counter: ${r.items.join(", ")}`,
        receiptImage: r.receiptImage!,
      });
    } catch (error) {
      return this.update(refillId, async (r, _all, now) => {
        r.history.push({ at: now, event: `HR submission failed (${(error as Error).message}); will retry` });
        return [];
      });
    }
    return this.update(refillId, async (r, _all, now) => {
      Object.assign(r, { state: "claim_submitted", claimId, claimSubmittedAt: now, claimRetryAt: null });
      r.history.push({ at: now, event: `claim ${claimId} submitted to HR` });
      return [dm(r.buyerId!, `Your claim for ${r.amount} has been sent to HR (${claimId}). HR approves within 1–10 days and pays you in your payroll currency.`)];
    });
  }

  private async checkClaim(refillId: string): Promise<Refill> {
    const current = await this.repo.get(refillId);
    const status = await this.hr.getClaimStatus(current.claimId!);
    return this.update(refillId, async (r, _all, now) => {
      if (r.state !== "claim_submitted") return null;
      const office = this.office(r.officeId);
      const buyer = this.volunteer(r.buyerId!);
      if (status === "approved") {
        Object.assign(r, { state: "reimbursed", resolvedAt: now });
        r.history.push({ at: now, event: `claim ${r.claimId} approved` });
        return [dm(buyer.id, `HR approved your claim ${r.claimId} for ${r.amount}.`)];
      }
      if (status === "rejected") {
        Object.assign(r, { state: "claim_rejected", resolvedAt: now });
        r.history.push({ at: now, event: `claim ${r.claimId} rejected` });
        return [
          dm(buyer.id, `HR rejected your claim ${r.claimId} for ${r.amount}. The office coordinator has been told and will follow up.`),
          dm(office.coordinatorId, `HR rejected ${buyer.name}'s claim ${r.claimId} for ${r.amount} (refill ${r.id}). Please follow up.`),
        ];
      }
      const waited = now.getTime() - r.claimSubmittedAt!.getTime();
      const sinceReminder = r.lastHrReminderAt ? now.getTime() - r.lastHrReminderAt.getTime() : Infinity;
      if (waited < this.policy.hrSlaMs || sinceReminder < this.policy.hrReminderIntervalMs) return null;
      r.lastHrReminderAt = now;
      r.history.push({ at: now, event: `reminded coordinator: claim pending ${Math.floor(waited / DAY)} days` });
      return [dm(office.coordinatorId, `${buyer.name}'s claim ${r.claimId} for ${r.amount} has been waiting ${Math.floor(waited / DAY)} days at HR. Please follow up.`)];
    });
  }

  // ── helpers ───────────────────────────────────────────────────────────

  /** Checks the budget, then offers the refill to the best available volunteer, or opens it to everyone. */
  private async findBuyer(r: Refill, all: Refill[], now: Date): Promise<Notice[]> {
    const office = this.office(r.officeId);
    const today = localDay(now, office.timeZone);
    const cap = spendCap(office, others(all, r), localMonth(now, office.timeZone));
    if (!cap) {
      const { remaining } = budgetPosition(office, others(all, r), localMonth(now, office.timeZone));
      Object.assign(r, { state: "on_hold_budget", offeredTo: null, offerExpiresAt: null, openCallRetryAt: null });
      r.history.push({ at: now, event: `on hold: ${remaining} left this month` });
      return [
        dm(office.coordinatorId, `The ${office.name} snack box is empty but only ${remaining} of this month's budget is left. It will be offered again when next month's budget starts.`),
        post(office.id, "The snack box is empty, but this month's snack budget is used up. It will be refilled when next month's budget starts."),
      ];
    }

    const locations = await this.locationsOn(today);
    const excluded = new Set(r.passedOverDay === today ? r.passedOver : []);
    const pick = chooseBuyer(office, [...this.volunteers.values()], others(all, r), (id) => locations.get(id) ?? null, now, excluded);
    r.state = "awaiting_buyer";
    if (pick) {
      Object.assign(r, { offeredTo: pick.id, offerExpiresAt: later(now, this.policy.offerTtlMs), openCallRetryAt: null });
      r.history.push({ at: now, event: `offered to ${pick.id}` });
      return [
        dm(pick.id, `The ${office.name} snack box is empty. Can you refill it? You can spend up to ${cap}. Please accept or decline within ${this.hours(this.policy.offerTtlMs)} hours.`),
        post(office.id, `The snack box is empty. ${pick.name} has been asked to refill it.`),
      ];
    }
    Object.assign(r, { offeredTo: null, offerExpiresAt: null, openCallRetryAt: later(now, this.policy.openCallRetryMs) });
    r.history.push({ at: now, event: "open call: no volunteer available" });
    return [post(office.id, `The snack box is empty and no volunteer on the list is available. Whoever is in the office can take it (spend up to ${cap}): the first to accept gets it.`)];
  }

  /** Remembers who passed on this refill today, so they aren't asked again until tomorrow. */
  private passOver(r: Refill, volunteerId: string, now: Date, reason: string): void {
    const today = localDay(now, this.office(r.officeId).timeZone);
    if (r.passedOverDay !== today) {
      r.passedOver = [];
      r.passedOverDay = today;
    }
    if (!r.passedOver.includes(volunteerId)) r.passedOver.push(volunteerId);
    r.history.push({ at: now, event: `${volunteerId} ${reason}` });
  }

  /** Drops the buyer and their budget reservation. */
  private unassign(r: Refill, now: Date, reason: string): void {
    this.passOver(r, r.buyerId!, now, reason);
    Object.assign(r, { buyerId: null, committedAt: null, purchaseDueAt: null, spendCap: null });
  }

  private async locationsOn(day: string): Promise<Map<string, string | null>> {
    const entries = await Promise.all(
      [...this.volunteers.keys()].map(async (id) => [id, await this.calendar.locationOn(id, day)] as const),
    );
    return new Map(entries);
  }

  /** Read, apply the change, then write only if nobody else changed the refill meanwhile; retry otherwise. */
  private async update(refillId: string, change: Change): Promise<Refill> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const r = await this.repo.get(refillId);
      const all = await this.repo.all();
      const notices = await change(r, all, this.clock.now());
      if (notices === null) return r;
      try {
        const saved = await this.repo.save(r);
        await this.send(notices);
        return saved;
      } catch (error) {
        if (!(error instanceof ConcurrentModification)) throw error;
      }
    }
    throw new RefillError(`refill ${refillId} is busy, please try again`);
  }

  private async alreadyHandled(r: Refill, reporterId: string): Promise<Refill> {
    const office = this.office(r.officeId);
    const status =
      r.state === "committed" ? `${this.volunteer(r.buyerId!).name} is buying`
      : r.state === "on_hold_budget" ? "on hold until the budget allows"
      : r.offeredTo ? `${this.volunteer(r.offeredTo).name} has been asked`
      : "it's open for anyone to take";
    await this.chat.sendDirect(reporterId, `Thanks! The ${office.name} box is already being handled: ${status}.`);
    return r;
  }

  private async send(notices: Notice[]): Promise<void> {
    for (const n of notices) {
      if (n.kind === "direct") await this.chat.sendDirect(n.to, n.text);
      else await this.chat.postToChannel(n.to, n.text);
    }
  }

  private hours(ms: number): number {
    return ms / HOUR;
  }

  private office(id: string): Office {
    const office = this.offices.get(id);
    if (!office) throw new RefillError(`unknown office ${id}`);
    return office;
  }

  private volunteer(id: string): Volunteer {
    const v = this.volunteers.get(id);
    if (!v) throw new NotAllowed(`${id} is not a snack volunteer`);
    return v;
  }
}
