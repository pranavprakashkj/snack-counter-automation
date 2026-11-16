/** A fresh simulated world for each test: both offices, six volunteers, fake chat, HR, calendar and clock. */

import { newRefill, type Refill, type RefillState } from "../src/domain.ts";
import { FakeCalendar, FakeChat, FakeClock, FakeHr } from "../src/fakes.ts";
import { Money } from "../src/money.ts";
import { InMemoryRefillRepository } from "../src/repository.ts";
import { HOME_OFFICE, OFFICES, PAYROLL_CURRENCY, VOLUNTEERS } from "../src/sample.ts";
import { RefillService, type Receipt } from "../src/service.ts";

export const MONDAY_9AM_OSLO = new Date("2026-11-16T08:00:00Z");

export function makeWorld(start = MONDAY_9AM_OSLO) {
  const clock = new FakeClock(start);
  const chat = new FakeChat();
  const hr = new FakeHr(PAYROLL_CURRENCY);
  const calendar = new FakeCalendar(HOME_OFFICE);
  const repo = new InMemoryRefillRepository();
  const service = new RefillService({ offices: OFFICES, volunteers: VOLUNTEERS, repo, chat, hr, calendar, clock });
  return { clock, chat, hr, calendar, repo, service };
}

export function receipt(amount: number, currency: string, items = ["snacks"]): Receipt {
  return { amount: Money.of(amount, currency), receiptImage: new Uint8Array([0xff, 0xd8]), items };
}

let seq = 1;

/** A finished purchase, for setting up budget and fairness history. */
export function purchase(officeId: string, buyerId: string, amount: Money, at: Date, state: RefillState = "reimbursed"): Refill {
  const r = newRefill(`S-${seq++}`, officeId, buyerId, at);
  Object.assign(r, {
    state, buyerId, committedAt: at, spendCap: amount, amount, purchasedAt: at,
    items: ["seed"], receiptImage: new Uint8Array([1]), resolvedAt: state === "reimbursed" ? at : null,
  });
  return r;
}

export async function seed(repo: InMemoryRefillRepository, ...refills: Refill[]): Promise<void> {
  for (const r of refills) await repo.addIfNoneActive(r);
}

/** Puts everyone except the listed volunteers away from the office on that day. */
export function onlyInOffice(calendar: FakeCalendar, day: string, present: string[]): void {
  for (const v of VOLUNTEERS) if (!present.includes(v.id)) calendar.set(v.id, day, null);
}
