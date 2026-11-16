import { describe, expect, it } from "vitest";
import { newRefill, type Refill } from "../src/domain.ts";
import { Money } from "../src/money.ts";
import { OSLO, VOLUNTEERS } from "../src/sample.ts";
import { chooseBuyer } from "../src/selection.ts";
import { makeWorld, purchase } from "./world.ts";

const NOW = new Date("2026-11-16T08:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);
const nok = (n: number) => Money.of(n, "NOK");

const allAtHome = (id: string) => VOLUNTEERS.find((v) => v.id === id)!.homeOfficeId;
const choose = (refills: Refill[], where: (id: string) => string | null = allAtHome, exclude = new Set<string>()) =>
  chooseBuyer(OSLO, VOLUNTEERS, refills, where, NOW, exclude)?.id ?? null;

describe("choosing who buys", () => {
  it("prefers whoever has done the fewest refills in the last 90 days", () => {
    const history = [
      purchase("OSL", "ingrid", nok(500), daysAgo(10)),
      purchase("OSL", "ingrid", nok(500), daysAgo(40)),
      purchase("OSL", "lars", nok(500), daysAgo(20)),
    ];
    expect(choose(history)).toBe("sofie");
  });

  it("ignores refills older than 90 days", () => {
    const history = [
      purchase("OSL", "ingrid", nok(500), daysAgo(120)),
      purchase("OSL", "lars", nok(500), daysAgo(5)),
      purchase("OSL", "sofie", nok(500), daysAgo(6)),
    ];
    expect(choose(history)).toBe("ingrid");
  });

  it("asks people still waiting for their money last, even if they've done fewer refills", () => {
    const history = [
      purchase("OSL", "ingrid", nok(500), daysAgo(3), "claim_submitted"),
      purchase("OSL", "lars", nok(500), daysAgo(30)),
      purchase("OSL", "lars", nok(500), daysAgo(60)),
      purchase("OSL", "sofie", nok(500), daysAgo(20)),
    ];
    expect(choose(history)).toBe("sofie");
    expect(choose(history, allAtHome, new Set(["sofie"]))).toBe("lars");
  });

  it("breaks ties by longest since last refill", () => {
    const history = [
      purchase("OSL", "ingrid", nok(500), daysAgo(5)),
      purchase("OSL", "lars", nok(500), daysAgo(50)),
      purchase("OSL", "sofie", nok(500), daysAgo(25)),
    ];
    expect(choose(history)).toBe("lars");
  });

  it("only asks people who are at that office today", () => {
    const where = (id: string) => (id === "ingrid" ? null : id === "lars" ? "BLR" : allAtHome(id));
    expect(choose([], where)).toBe("sofie");
  });

  it("asks a visitor from the other office where they are", () => {
    const where = (id: string) => (id === "arjun" ? "OSL" : id === "priya" || id === "meera" ? "BLR" : null);
    expect(choose([], where)).toBe("arjun");
  });

  it("skips someone already committed to another refill", () => {
    const busy = newRefill("R-x", "BLR", "priya", NOW);
    Object.assign(busy, { state: "committed", buyerId: "ingrid" });
    expect(choose([busy])).toBe("lars");
  });

  it("returns nobody when nobody is in", () => {
    expect(choose([], () => null)).toBeNull();
  });
});

describe("visiting the other office", () => {
  it("charges the visited office's budget in its currency; HR pays the visitor in their payroll currency", async () => {
    const { service, repo, hr, calendar } = makeWorld();
    for (const id of ["ingrid", "lars", "sofie"]) calendar.set(id, "2026-11-16", null);
    calendar.set("arjun", "2026-11-16", "OSL");

    const refill = await service.reportEmpty("OSL", "ingrid");
    expect(refill.offeredTo).toBe("arjun");
    await service.accept(refill.id, "arjun");
    const done = await service.submitReceipt(refill.id, "arjun", {
      amount: Money.of(1000, "NOK"), receiptImage: new Uint8Array([1]), items: ["Freia"],
    });

    const claim = hr.claims.get(done.claimId!)!;
    expect(claim.request.amount.toString()).toBe("1,000.00 NOK");
    expect(claim.payoutCurrency).toBe("INR");
    expect((await repo.get(refill.id)).officeId).toBe("OSL");
  });

  it("doesn't ask a visitor at their home office while they're away", async () => {
    const { service, calendar } = makeWorld();
    calendar.set("arjun", "2026-11-16", "OSL");
    const refill = await service.reportEmpty("BLR", "priya");
    expect(refill.offeredTo).toBe("meera");
  });
});
