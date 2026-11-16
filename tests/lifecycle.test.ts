import { describe, expect, it } from "vitest";
import { budgetPosition } from "../src/budget.ts";
import { AlreadyTaken, NotAllowed } from "../src/domain.ts";
import { ConcurrentModification } from "../src/repository.ts";
import { OSLO } from "../src/sample.ts";
import { makeWorld, onlyInOffice, receipt } from "./world.ts";

const MONDAY = "2026-11-16";

describe("only one person buys", () => {
  it("two people cannot both commit to the same refill", async () => {
    const { service, calendar, repo, chat } = makeWorld();
    onlyInOffice(calendar, MONDAY, []); // nobody on the list is in, so it becomes an open call
    const refill = await service.reportEmpty("OSL", "lars");
    expect(refill.offeredTo).toBeNull();

    let conflicts = 0;
    const save = repo.save.bind(repo);
    repo.save = async (r) => {
      try {
        return await save(r);
      } catch (e) {
        if (e instanceof ConcurrentModification) conflicts++;
        throw e;
      }
    };

    const results = await Promise.allSettled([service.accept(refill.id, "lars"), service.accept(refill.id, "sofie")]);

    expect(conflicts).toBe(1); // both read the open refill; the second write was refused
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failure = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failure.reason).toBeInstanceOf(AlreadyTaken);
    const saved = await repo.get(refill.id);
    expect(saved.state).toBe("committed");
    expect(chat.channel("OSL").filter((t) => t.includes("is refilling"))).toHaveLength(1);
  });

  it("refuses a second commitment after the first", async () => {
    const { service } = makeWorld();
    const refill = await service.reportEmpty("OSL", "lars");
    await service.accept(refill.id, "ingrid");
    await expect(service.accept(refill.id, "ingrid")).rejects.toBeInstanceOf(AlreadyTaken);
    await expect(service.accept(refill.id, "lars")).rejects.toBeInstanceOf(AlreadyTaken);
  });

  it("only the person offered a refill can accept it", async () => {
    const { service } = makeWorld();
    const refill = await service.reportEmpty("OSL", "lars");
    expect(refill.offeredTo).toBe("ingrid");
    await expect(service.accept(refill.id, "lars")).rejects.toBeInstanceOf(NotAllowed);
  });

  it("reporting the same empty box twice does not start a second refill", async () => {
    const { service, repo, chat } = makeWorld();
    const [a, b] = await Promise.all([service.reportEmpty("OSL", "lars"), service.reportEmpty("OSL", "sofie")]);
    const c = await service.reportEmpty("OSL", "ingrid");

    expect(new Set([a.id, b.id, c.id]).size).toBe(1);
    expect(await repo.all()).toHaveLength(1);
    expect(chat.directTo("ingrid").filter((t) => t.includes("Can you refill it"))).toHaveLength(1);
    expect(chat.directTo("ingrid").at(-1)).toContain("already being handled");
  });

  it("treats the two offices independently", async () => {
    const { service } = makeWorld();
    const oslo = await service.reportEmpty("OSL", "lars");
    const blr = await service.reportEmpty("BLR", "meera");
    expect(oslo.id).not.toBe(blr.id);
    expect(blr.offeredTo).toBe("arjun");
  });

  it("starts a new refill once the previous one has been bought", async () => {
    const { service } = makeWorld();
    const first = await service.reportEmpty("OSL", "lars");
    await service.accept(first.id, "ingrid");
    await service.submitReceipt(first.id, "ingrid", receipt(800, "NOK"));
    const second = await service.reportEmpty("OSL", "lars");
    expect(second.id).not.toBe(first.id);
  });
});

describe("a refill nobody completes is handed to someone else", () => {
  it("passes an unanswered offer to the next volunteer after 2 hours", async () => {
    const { service, clock, repo, chat } = makeWorld();
    const refill = await service.reportEmpty("OSL", "sofie");

    clock.advanceHours(1.9);
    await service.tick();
    expect((await repo.get(refill.id)).offeredTo).toBe("ingrid");

    clock.advanceHours(0.1);
    await service.tick();
    expect((await repo.get(refill.id)).offeredTo).toBe("lars");
    expect(chat.directTo("ingrid").at(-1)).toContain("passed to someone else");
  });

  it("moves to the next volunteer on decline, then to an open call when everyone has passed", async () => {
    const { service, repo, chat } = makeWorld();
    const refill = await service.reportEmpty("OSL", "sofie");
    await service.decline(refill.id, "ingrid");
    expect((await repo.get(refill.id)).offeredTo).toBe("lars");
    await service.decline(refill.id, "lars");
    expect((await repo.get(refill.id)).offeredTo).toBe("sofie");
    await service.decline(refill.id, "sofie");

    const open = await repo.get(refill.id);
    expect(open.state).toBe("awaiting_buyer");
    expect(open.offeredTo).toBeNull();
    expect(chat.channel("OSL").at(-1)).toContain("first to accept gets it");
  });

  it("asks people who passed again on a later day", async () => {
    const { service, repo, clock } = makeWorld();
    const refill = await service.reportEmpty("OSL", "sofie");
    for (const id of ["ingrid", "lars", "sofie"]) await service.decline(refill.id, id);

    clock.advanceHours(4);
    await service.tick();
    expect((await repo.get(refill.id)).offeredTo).toBeNull(); // same day: still an open call

    clock.advanceHours(20);
    await service.tick();
    expect((await repo.get(refill.id)).offeredTo).toBe("ingrid");
  });

  it("re-offers an open call when someone turns up later that day", async () => {
    const { service, repo, clock, calendar } = makeWorld();
    onlyInOffice(calendar, MONDAY, []);
    const refill = await service.reportEmpty("OSL", "sofie");
    expect(refill.offeredTo).toBeNull();

    calendar.set("lars", MONDAY, "OSL");
    clock.advanceHours(4);
    await service.tick();
    expect((await repo.get(refill.id)).offeredTo).toBe("lars");
  });

  it("releases a buyer who uploads no receipt within 24 hours, with their budget reservation", async () => {
    const { service, repo, clock, chat } = makeWorld();
    const refill = await service.reportEmpty("OSL", "sofie");
    await service.accept(refill.id, "ingrid");
    expect(budgetPosition(OSLO, await repo.all(), "2026-11").reserved.toString()).toBe("1,200.00 NOK");

    clock.advanceHours(24);
    await service.tick();

    const after = await repo.get(refill.id);
    expect(after.state).toBe("awaiting_buyer");
    expect(after.buyerId).toBeNull();
    expect(after.offeredTo).toBe("lars");
    expect(budgetPosition(OSLO, await repo.all(), "2026-11").reserved.minor).toBe(0);
    expect(chat.directTo("ingrid").at(-1)).toContain("passed to someone else");
    await expect(service.submitReceipt(refill.id, "ingrid", receipt(800, "NOK"))).rejects.toBeInstanceOf(NotAllowed);
  });

  it("lets a buyer hand the refill back", async () => {
    const { service, repo } = makeWorld();
    const refill = await service.reportEmpty("OSL", "sofie");
    await service.accept(refill.id, "ingrid");
    await service.release(refill.id, "ingrid");
    expect((await repo.get(refill.id)).offeredTo).toBe("lars");
  });
});

describe("from purchase to reimbursed", () => {
  it("submits the claim to HR on upload and marks it reimbursed once HR approves", async () => {
    const { service, repo, hr, clock, chat } = makeWorld();
    const refill = await service.reportEmpty("OSL", "sofie");
    await service.accept(refill.id, "ingrid");
    const submitted = await service.submitReceipt(refill.id, "ingrid", receipt(800, "NOK", ["Smash", "Kvikk Lunsj"]));

    expect(submitted.state).toBe("claim_submitted");
    const claim = hr.claims.get(submitted.claimId!)!;
    expect(claim.request.employeeId).toBe("ingrid");
    expect(claim.request.amount.toString()).toBe("800.00 NOK");
    expect(claim.request.receiptImage.length).toBeGreaterThan(0);
    expect(claim.request.description).toContain(refill.id);

    clock.advanceDays(3);
    hr.approve(submitted.claimId!);
    await service.tick();
    const done = await repo.get(refill.id);
    expect(done.state).toBe("reimbursed");
    expect(chat.directTo("ingrid").at(-1)).toContain("HR approved");
  });

  it("retries a failed HR submission without sending the claim twice", async () => {
    const { service, repo, hr, clock } = makeWorld();
    hr.failNextCalls(1);
    const refill = await service.reportEmpty("OSL", "sofie");
    await service.accept(refill.id, "ingrid");
    expect((await service.submitReceipt(refill.id, "ingrid", receipt(800, "NOK"))).state).toBe("purchased");

    await service.tick();
    expect(hr.claims.size).toBe(0); // still inside the retry wait

    clock.advanceHours(0.25);
    await service.tick();
    await service.tick();
    expect((await repo.get(refill.id)).state).toBe("claim_submitted");
    expect(hr.claims.size).toBe(1);
  });

  it("reminds the coordinator every day once a claim has waited 10 days", async () => {
    const { service, clock, chat } = makeWorld();
    const refill = await service.reportEmpty("OSL", "sofie");
    await service.decline(refill.id, "ingrid");
    await service.accept(refill.id, "lars");
    await service.submitReceipt(refill.id, "lars", receipt(800, "NOK"));
    const reminders = () => chat.directTo("ingrid").filter((t) => t.includes("waiting")).length;

    clock.advanceDays(9);
    await service.tick();
    expect(reminders()).toBe(0);

    clock.advanceDays(1);
    await service.tick();
    await service.tick();
    expect(reminders()).toBe(1);

    clock.advanceDays(1);
    await service.tick();
    expect(reminders()).toBe(2);
  });

  it("tells the buyer and coordinator when HR rejects, and keeps it as spend", async () => {
    const { service, repo, hr, chat } = makeWorld();
    const refill = await service.reportEmpty("OSL", "sofie");
    await service.decline(refill.id, "ingrid");
    await service.accept(refill.id, "lars");
    const submitted = await service.submitReceipt(refill.id, "lars", receipt(800, "NOK"));

    hr.reject(submitted.claimId!);
    await service.tick();

    expect((await repo.get(refill.id)).state).toBe("claim_rejected");
    expect(chat.directTo("lars").at(-1)).toContain("rejected");
    expect(chat.directTo("ingrid").at(-1)).toContain("rejected");
    expect(budgetPosition(OSLO, await repo.all(), "2026-11").spent.toString()).toBe("800.00 NOK");
  });
});
