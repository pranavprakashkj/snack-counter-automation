import { describe, expect, it } from "vitest";
import { budgetPosition, spendCap } from "../src/budget.ts";
import { NotAllowed, RefillError } from "../src/domain.ts";
import { Money } from "../src/money.ts";
import { BENGALURU, OSLO } from "../src/sample.ts";
import { makeWorld, purchase, receipt, seed } from "./world.ts";

const nok = (n: number) => Money.of(n, "NOK");
const inr = (n: number) => Money.of(n, "INR");
const EARLY_NOV = new Date("2026-11-02T10:00:00Z");

describe("budget check", () => {
  it("caps a refill at the office's typical maximum when there's plenty left", () => {
    expect(spendCap(OSLO, [], "2026-11")!.toString()).toBe("1,200.00 NOK");
    expect(spendCap(BENGALURU, [], "2026-11")!.toString()).toBe("3,000.00 INR");
  });

  it("shrinks the cap to what's left of the month", () => {
    const spent = [purchase("OSL", "lars", nok(5400), EARLY_NOV)];
    expect(spendCap(OSLO, spent, "2026-11")!.toString()).toBe("600.00 NOK");
  });

  it("refuses when what's left is below a minimum purchase", () => {
    const spent = [purchase("OSL", "lars", nok(5800), EARLY_NOV)];
    expect(spendCap(OSLO, spent, "2026-11")).toBeNull();
  });

  it("keeps each office's budget in its own currency", () => {
    const refills = [purchase("OSL", "lars", nok(1000), EARLY_NOV), purchase("BLR", "arjun", inr(2500), EARLY_NOV)];
    expect(budgetPosition(OSLO, refills, "2026-11").remaining.toString()).toBe("5,000.00 NOK");
    expect(budgetPosition(BENGALURU, refills, "2026-11").remaining.toString()).toBe("12,500.00 INR");
  });

  it("counts a purchase in the office's local month", () => {
    // 19:00 UTC on 30 Nov is still November in Oslo but already 1 Dec in Bengaluru.
    const at = new Date("2026-11-30T19:00:00Z");
    const refills = [purchase("OSL", "lars", nok(1000), at), purchase("BLR", "arjun", inr(1000), at)];
    expect(budgetPosition(OSLO, refills, "2026-11").spent.toString()).toBe("1,000.00 NOK");
    expect(budgetPosition(BENGALURU, refills, "2026-11").spent.minor).toBe(0);
    expect(budgetPosition(BENGALURU, refills, "2026-12").spent.toString()).toBe("1,000.00 INR");
  });

  it("reserves the cap while someone is buying", async () => {
    const { service, repo } = makeWorld();
    await seed(repo, purchase("OSL", "lars", nok(4000), EARLY_NOV));
    const refill = await service.reportEmpty("OSL", "sofie");
    const committed = await service.accept(refill.id, "ingrid");

    expect(committed.spendCap!.toString()).toBe("1,200.00 NOK");
    const position = budgetPosition(OSLO, await repo.all(), "2026-11");
    expect(position.reserved.toString()).toBe("1,200.00 NOK");
    expect(position.remaining.toString()).toBe("800.00 NOK");
  });

  it("puts a refill on hold when the budget is used up, and offers it when the new month starts", async () => {
    const { service, repo, clock, chat } = makeWorld(new Date("2026-11-27T08:00:00Z"));
    await seed(repo, purchase("OSL", "lars", nok(5800), EARLY_NOV));

    const refill = await service.reportEmpty("OSL", "sofie");
    expect(refill.state).toBe("on_hold_budget");
    expect(chat.directTo("ingrid").at(-1)).toContain("200.00 NOK of this month's budget is left");
    await expect(service.accept(refill.id, "ingrid")).rejects.toBeInstanceOf(RefillError);

    clock.set(new Date("2026-11-30T22:30:00Z")); // still 30 Nov in Oslo
    await service.tick();
    expect((await repo.get(refill.id)).state).toBe("on_hold_budget");

    clock.set(new Date("2026-11-30T23:30:00Z")); // 1 Dec, 00:30 in Oslo
    await service.tick();
    const resumed = await repo.get(refill.id);
    expect(resumed.state).toBe("awaiting_buyer");
    expect(resumed.offeredTo).not.toBeNull();
  });

  it("holds an over-cap receipt for the coordinator before anything goes to HR", async () => {
    const { service, hr, chat } = makeWorld();
    const refill = await service.reportEmpty("BLR", "priya");
    await service.accept(refill.id, "arjun");
    const held = await service.submitReceipt(refill.id, "arjun", receipt(3400, "INR"));

    expect(held.state).toBe("needs_approval");
    expect(hr.claims.size).toBe(0);
    expect(chat.directTo("priya").at(-1)).toContain("above the agreed 3,000.00 INR");

    await expect(service.approvePurchase(refill.id, "meera")).rejects.toBeInstanceOf(NotAllowed);
    const approved = await service.approvePurchase(refill.id, "priya");
    expect(approved.state).toBe("claim_submitted");
    expect(hr.claims.get(approved.claimId!)!.request.amount.toString()).toBe("3,400.00 INR");
  });

  it("rejects a receipt in a different currency from the counter's", async () => {
    const { service } = makeWorld();
    const refill = await service.reportEmpty("OSL", "sofie");
    await service.accept(refill.id, "ingrid");
    await expect(service.submitReceipt(refill.id, "ingrid", receipt(800, "INR"))).rejects.toThrow("must be in NOK");
  });
});
