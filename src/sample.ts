/** Office configuration from the brief, plus a few sample volunteers for tests and the demo. */

import type { Office, Volunteer } from "./domain.ts";
import { Money } from "./money.ts";

// Budgets from the brief. The typical purchase range sets the minimum worth a
// trip and the default spend cap per refill.
export const OSLO: Office = {
  id: "OSL",
  name: "Oslo",
  currency: "NOK",
  timeZone: "Europe/Oslo",
  monthlyBudget: Money.of(6000, "NOK"),
  minPurchase: Money.of(300, "NOK"),
  maxPurchase: Money.of(1200, "NOK"),
  coordinatorId: "ingrid",
};

export const BENGALURU: Office = {
  id: "BLR",
  name: "Bengaluru",
  currency: "INR",
  timeZone: "Asia/Kolkata",
  monthlyBudget: Money.of(15000, "INR"),
  minPurchase: Money.of(500, "INR"),
  maxPurchase: Money.of(3000, "INR"),
  coordinatorId: "priya",
};

export const OFFICES = [OSLO, BENGALURU];

export const VOLUNTEERS: Volunteer[] = [
  { id: "ingrid", name: "Ingrid", homeOfficeId: "OSL", active: true },
  { id: "lars", name: "Lars", homeOfficeId: "OSL", active: true },
  { id: "sofie", name: "Sofie", homeOfficeId: "OSL", active: true },
  { id: "priya", name: "Priya", homeOfficeId: "BLR", active: true },
  { id: "arjun", name: "Arjun", homeOfficeId: "BLR", active: true },
  { id: "meera", name: "Meera", homeOfficeId: "BLR", active: true },
];

/** What the HR system knows: each employee's payroll currency. */
export const PAYROLL_CURRENCY = new Map(VOLUNTEERS.map((v) => [v.id, v.homeOfficeId === "OSL" ? "NOK" : "INR"]));

export const HOME_OFFICE = new Map(VOLUNTEERS.map((v) => [v.id, v.homeOfficeId]));
