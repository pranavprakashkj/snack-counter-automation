/**
 * The monthly report for management: each office in its own currency, plus
 * one combined total in a reporting currency at rates supplied for that month.
 * Each office's month follows its own local time zone.
 */

import { localMonth, OUTSTANDING_STATES, SPENT_STATES, type Office, type Refill } from "./domain.ts";
import { convert, sum, type Money } from "./money.ts";

const HOUR = 60 * 60 * 1000;

export interface OfficeMonthReport {
  officeId: string;
  officeName: string;
  budget: Money;
  spent: Money;
  remaining: Money;
  refills: number;
  refillsByBuyer: Record<string, number>;
  items: Record<string, number>;
  awaitingReimbursement: Money;
  overCapRefills: string[];
  rejectedClaims: string[];
  avgHoursEmptyToRefilled: number | null;
  avgDaysToReimburse: number | null;
  spentInReportingCurrency: Money;
  budgetInReportingCurrency: Money;
}

export interface MonthlyReport {
  month: string;
  reportingCurrency: string;
  fxRates: Readonly<Record<string, number>>;
  offices: OfficeMonthReport[];
  totalSpent: Money;
  totalBudget: Money;
}

export interface ReportInput {
  month: string;                              // YYYY-MM
  offices: readonly Office[];
  refills: readonly Refill[];
  reportingCurrency: string;
  fxRates: Readonly<Record<string, number>>;  // units of reportingCurrency per 1 unit of each currency
}

const average = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function tally(keys: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = (out[k] ?? 0) + 1;
  return out;
}

export function monthlyReport(input: ReportInput): MonthlyReport {
  const { month, reportingCurrency, fxRates } = input;
  const offices = input.offices.map((office): OfficeMonthReport => {
    const bought = input.refills.filter(
      (r) => r.officeId === office.id && SPENT_STATES.has(r.state) && localMonth(r.purchasedAt!, office.timeZone) === month,
    );
    const spent = sum(bought.map((r) => r.amount!), office.currency);
    return {
      officeId: office.id,
      officeName: office.name,
      budget: office.monthlyBudget,
      spent,
      remaining: office.monthlyBudget.minus(spent),
      refills: bought.length,
      refillsByBuyer: tally(bought.map((r) => r.buyerId!)),
      items: tally(bought.flatMap((r) => r.items)),
      awaitingReimbursement: sum(bought.filter((r) => OUTSTANDING_STATES.has(r.state)).map((r) => r.amount!), office.currency),
      overCapRefills: bought.filter((r) => r.amount!.greaterThan(r.spendCap!)).map((r) => r.id),
      rejectedClaims: bought.filter((r) => r.state === "claim_rejected").map((r) => r.id),
      avgHoursEmptyToRefilled: average(bought.map((r) => (r.purchasedAt!.getTime() - r.reportedAt.getTime()) / HOUR)),
      avgDaysToReimburse: average(
        bought.filter((r) => r.state === "reimbursed").map((r) => (r.resolvedAt!.getTime() - r.purchasedAt!.getTime()) / (24 * HOUR)),
      ),
      spentInReportingCurrency: convert(spent, reportingCurrency, fxRates),
      budgetInReportingCurrency: convert(office.monthlyBudget, reportingCurrency, fxRates),
    };
  });
  return {
    month,
    reportingCurrency,
    fxRates,
    offices,
    totalSpent: sum(offices.map((o) => o.spentInReportingCurrency), reportingCurrency),
    totalBudget: sum(offices.map((o) => o.budgetInReportingCurrency), reportingCurrency),
  };
}

export function renderReport(report: MonthlyReport): string {
  const lines = [`Snack spending, ${report.month}`, ""];
  for (const o of report.offices) {
    lines.push(
      `${o.officeName}: spent ${o.spent} of ${o.budget} (${o.remaining} left), ${o.refills} refill(s)`,
      `  in ${report.reportingCurrency}: ${o.spentInReportingCurrency}`,
      `  buyers: ${Object.entries(o.refillsByBuyer).map(([k, n]) => `${k} ×${n}`).join(", ") || "none"}`,
      `  items: ${Object.entries(o.items).map(([k, n]) => `${k} ×${n}`).join(", ") || "none"}`,
      `  still owed to buyers: ${o.awaitingReimbursement}`,
      `  avg hours from empty to refilled: ${o.avgHoursEmptyToRefilled?.toFixed(1) ?? "n/a"}`,
      `  avg days to reimburse: ${o.avgDaysToReimburse?.toFixed(1) ?? "n/a"}`,
    );
    if (o.overCapRefills.length) lines.push(`  over cap: ${o.overCapRefills.join(", ")}`);
    if (o.rejectedClaims.length) lines.push(`  rejected by HR: ${o.rejectedClaims.join(", ")}`);
    lines.push("");
  }
  const rates = Object.entries(report.fxRates).map(([c, r]) => `1 ${c} = ${r} ${report.reportingCurrency}`).join(", ");
  lines.push(`Total: ${report.totalSpent} of ${report.totalBudget} (rates: ${rates})`);
  return lines.join("\n");
}
