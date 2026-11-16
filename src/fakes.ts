/** Simulated stand-ins for the chat tool, the HR system, the office calendar and the clock. */

import type { Calendar, Chat, ClaimRequest, ClaimStatus, Clock, HrSystem } from "./ports.ts";

const HOUR = 60 * 60 * 1000;

export class FakeClock implements Clock {
  private current: Date;

  constructor(start: Date) {
    this.current = start;
  }

  now(): Date {
    return new Date(this.current);
  }

  advanceHours(hours: number): void {
    this.current = new Date(this.current.getTime() + hours * HOUR);
  }

  advanceDays(days: number): void {
    this.advanceHours(days * 24);
  }

  set(at: Date): void {
    this.current = at;
  }
}

export interface ChatMessage {
  kind: "direct" | "channel";
  to: string;   // user ID or office ID
  text: string;
}

export class FakeChat implements Chat {
  readonly messages: ChatMessage[] = [];

  async sendDirect(userId: string, text: string): Promise<void> {
    this.messages.push({ kind: "direct", to: userId, text });
  }

  async postToChannel(officeId: string, text: string): Promise<void> {
    this.messages.push({ kind: "channel", to: officeId, text });
  }

  directTo(userId: string): string[] {
    return this.messages.filter((m) => m.kind === "direct" && m.to === userId).map((m) => m.text);
  }

  channel(officeId: string): string[] {
    return this.messages.filter((m) => m.kind === "channel" && m.to === officeId).map((m) => m.text);
  }
}

/** Defaults everyone to their home office every day; tests override specific days. */
export class FakeCalendar implements Calendar {
  private readonly overrides = new Map<string, string | null>();
  private readonly home: ReadonlyMap<string, string>;

  constructor(homeOffices: ReadonlyMap<string, string>) {
    this.home = homeOffices;
  }

  set(volunteerId: string, day: string, location: string | null): void {
    this.overrides.set(`${volunteerId}|${day}`, location);
  }

  async locationOn(volunteerId: string, day: string): Promise<string | null> {
    const key = `${volunteerId}|${day}`;
    if (this.overrides.has(key)) return this.overrides.get(key)!;
    return this.home.get(volunteerId) ?? null;
  }
}

export class HrUnavailable extends Error {
  name = "HrUnavailable";
}

export interface FakeClaim {
  id: string;
  request: ClaimRequest;
  status: ClaimStatus;
  payoutCurrency: string;
}

/** Mimics the external HR system: it knows each employee's payroll currency and pays out in it. */
export class FakeHr implements HrSystem {
  readonly claims = new Map<string, FakeClaim>();
  private failuresLeft = 0;
  private nextId = 1;
  private readonly payrollCurrency: ReadonlyMap<string, string>;

  constructor(payrollCurrency: ReadonlyMap<string, string>) {
    this.payrollCurrency = payrollCurrency;
  }

  failNextCalls(count: number): void {
    this.failuresLeft = count;
  }

  async createClaim(request: ClaimRequest): Promise<string> {
    if (this.failuresLeft > 0) {
      this.failuresLeft--;
      throw new HrUnavailable("HR system timed out");
    }
    const payoutCurrency = this.payrollCurrency.get(request.employeeId);
    if (!payoutCurrency) throw new Error(`unknown employee ${request.employeeId}`);
    const id = `HR-${this.nextId++}`;
    this.claims.set(id, { id, request, status: "pending", payoutCurrency });
    return id;
  }

  async getClaimStatus(claimId: string): Promise<ClaimStatus> {
    const claim = this.claims.get(claimId);
    if (!claim) throw new Error(`unknown claim ${claimId}`);
    return claim.status;
  }

  approve(claimId: string): void {
    this.claims.get(claimId)!.status = "approved";
  }

  reject(claimId: string): void {
    this.claims.get(claimId)!.status = "rejected";
  }
}
