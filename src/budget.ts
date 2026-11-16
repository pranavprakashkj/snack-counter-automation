/**
 * Budget check, derived from the refill records rather than kept as a separate balance.
 *
 * Each office budgets in its own currency and its own local calendar month.
 * Spend is charged to the counter that was refilled (not the buyer's home
 * office) in the month of purchase. A committed refill reserves its spend cap
 * until the receipt arrives, so the cap a buyer is given is always covered.
 */

import { localMonth, SPENT_STATES, type Office, type Refill } from "./domain.ts";
import { minMoney, sum, type Money } from "./money.ts";

export interface BudgetPosition {
  budget: Money;
  spent: Money;
  reserved: Money;
  remaining: Money;
}

export function budgetPosition(office: Office, refills: readonly Refill[], month: string): BudgetPosition {
  const here = refills.filter((r) => r.officeId === office.id);
  const spent = sum(
    here
      .filter((r) => SPENT_STATES.has(r.state) && localMonth(r.purchasedAt!, office.timeZone) === month)
      .map((r) => r.amount!),
    office.currency,
  );
  const reserved = sum(
    here
      .filter((r) => r.state === "committed" && localMonth(r.committedAt!, office.timeZone) === month)
      .map((r) => r.spendCap!),
    office.currency,
  );
  return { budget: office.monthlyBudget, spent, reserved, remaining: office.monthlyBudget.minus(spent).minus(reserved) };
}

/** How much the next buyer may spend, or null if the budget can't cover a minimum purchase. */
export function spendCap(office: Office, refills: readonly Refill[], month: string): Money | null {
  const { remaining } = budgetPosition(office, refills, month);
  if (remaining.lessThan(office.minPurchase)) return null;
  return minMoney(office.maxPurchase, remaining);
}
