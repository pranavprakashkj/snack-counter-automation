/** Core data: offices, volunteers and the refill record that moves through the lifecycle. */

import type { Money } from "./money.ts";

export type RefillState =
  | "awaiting_buyer"   // box reported empty; offered to one volunteer, or open to anyone
  | "on_hold_budget"   // this month's budget can't cover even a small purchase
  | "committed"        // exactly one buyer has committed; their spend cap is reserved
  | "needs_approval"   // receipt is above the cap; the office coordinator must approve
  | "purchased"        // receipt recorded; claim not yet accepted by HR
  | "claim_submitted"  // waiting for HR to approve
  | "reimbursed"
  | "claim_rejected";

/** The box is still empty. At most one refill per office may be in these states. */
export const ACTIVE_STATES: ReadonlySet<RefillState> = new Set(["awaiting_buyer", "on_hold_budget", "committed"]);

/** Money has left someone's pocket, so it counts as spent against the budget. */
export const SPENT_STATES: ReadonlySet<RefillState> = new Set([
  "needs_approval", "purchased", "claim_submitted", "reimbursed", "claim_rejected",
]);

/** The buyer paid and is still waiting for their money. */
export const OUTSTANDING_STATES: ReadonlySet<RefillState> = new Set(["needs_approval", "purchased", "claim_submitted"]);

export class RefillError extends Error {
  name = "RefillError";
}

/** Someone else has already committed to this refill. */
export class AlreadyTaken extends RefillError {
  name = "AlreadyTaken";
}

/** The caller may not perform this action on this refill. */
export class NotAllowed extends RefillError {
  name = "NotAllowed";
}

export class InvalidState extends RefillError {
  name = "InvalidState";
}

export interface Office {
  id: string;
  name: string;
  currency: string;
  timeZone: string;
  monthlyBudget: Money;
  minPurchase: Money;     // below this a refill isn't worth a trip
  maxPurchase: Money;     // default spend cap per refill
  coordinatorId: string;  // receives escalations and approves over-cap receipts
}

export interface Volunteer {
  id: string;             // company login; assumed to equal the employee ID the HR system knows
  name: string;
  homeOfficeId: string;
  active: boolean;
}

export interface Refill {
  id: string;
  officeId: string;
  reportedBy: string;
  reportedAt: Date;
  state: RefillState;
  version: number;

  // finding a buyer
  offeredTo: string | null;            // null while awaiting_buyer means open call: anyone may take it
  offerExpiresAt: Date | null;
  openCallRetryAt: Date | null;
  passedOver: string[];                // declined, timed out or released
  passedOverDay: string | null;        // local day the passed-over list applies to

  // commitment
  buyerId: string | null;
  committedAt: Date | null;
  purchaseDueAt: Date | null;
  spendCap: Money | null;              // reserved against the budget while committed

  // purchase
  amount: Money | null;
  purchasedAt: Date | null;
  items: string[];
  receiptImage: Uint8Array | null;

  // reimbursement
  claimId: string | null;
  claimRetryAt: Date | null;           // also acts as a lease so a claim is sent once
  claimSubmittedAt: Date | null;
  lastHrReminderAt: Date | null;
  resolvedAt: Date | null;

  history: { at: Date; event: string }[];
}

export function newRefill(id: string, officeId: string, reportedBy: string, at: Date): Refill {
  return {
    id, officeId, reportedBy, reportedAt: at, state: "awaiting_buyer", version: 0,
    offeredTo: null, offerExpiresAt: null, openCallRetryAt: null, passedOver: [], passedOverDay: null,
    buyerId: null, committedAt: null, purchaseDueAt: null, spendCap: null,
    amount: null, purchasedAt: null, items: [], receiptImage: null,
    claimId: null, claimRetryAt: null, claimSubmittedAt: null, lastHrReminderAt: null, resolvedAt: null,
    history: [{ at, event: `reported empty by ${reportedBy}` }],
  };
}

/** Local calendar date at the office, as YYYY-MM-DD. */
export function localDay(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** Local calendar month at the office, as YYYY-MM. Budgets run per local month. */
export function localMonth(at: Date, timeZone: string): string {
  return localDay(at, timeZone).slice(0, 7);
}
