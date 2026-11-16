import { describe, expect, it } from "vitest";
import { convert, CurrencyMismatch, Money } from "../src/money.ts";
import { monthlyReport } from "../src/report.ts";
import { OFFICES } from "../src/sample.ts";
import { purchase } from "./world.ts";

const nok = (n: number | string) => Money.of(n, "NOK");
const inr = (n: number | string) => Money.of(n, "INR");

describe("money", () => {
  it("never adds or compares different currencies", () => {
    expect(() => nok(100).plus(inr(100))).toThrow(CurrencyMismatch);
    expect(() => nok(100).lessThan(inr(100))).toThrow(CurrencyMismatch);
  });

  it("is exact to the minor unit", () => {
    expect(nok("0.10").plus(nok("0.20")).equals(nok("0.30"))).toBe(true);
    expect(nok("1199.50").minor).toBe(119950);
  });

  it("converts only with an explicit rate", () => {
    expect(convert(inr(3400), "NOK", { INR: 0.125 }).toString()).toBe("425.00 NOK");
    expect(() => convert(inr(3400), "NOK", {})).toThrow("no INR->NOK rate");
  });
});

describe("monthly report", () => {
  const nov = (day: number) => new Date(Date.UTC(2026, 10, day, 10));
  const refills = [
    purchase("OSL", "lars", nok(840), nov(3)),
    purchase("OSL", "arjun", nok(1150), nov(17), "claim_submitted"),  // visitor from Bengaluru
    purchase("BLR", "meera", inr(3400), nov(17)),
    purchase("BLR", "priya", inr(2000), new Date("2026-10-31T10:00:00Z")),  // October: excluded
  ];
  const report = monthlyReport({ month: "2026-11", offices: OFFICES, refills, reportingCurrency: "NOK", fxRates: { INR: 0.125 } });
  const [oslo, blr] = report.offices;

  it("totals each office in its own currency, charging visitors to the office they bought for", () => {
    expect(oslo.spent.toString()).toBe("1,990.00 NOK");
    expect(oslo.remaining.toString()).toBe("4,010.00 NOK");
    expect(oslo.refillsByBuyer).toEqual({ lars: 1, arjun: 1 });
    expect(blr.spent.toString()).toBe("3,400.00 INR");
    expect(blr.remaining.toString()).toBe("11,600.00 INR");
  });

  it("gives one combined total in NOK", () => {
    expect(blr.spentInReportingCurrency.toString()).toBe("425.00 NOK");
    expect(report.totalSpent.toString()).toBe("2,415.00 NOK");
    expect(report.totalBudget.toString()).toBe("7,875.00 NOK"); // 6,000 NOK + 15,000 INR × 0.125
  });

  it("shows money still owed to buyers", () => {
    expect(oslo.awaitingReimbursement.toString()).toBe("1,150.00 NOK");
    expect(blr.awaitingReimbursement.minor).toBe(0);
  });
});
