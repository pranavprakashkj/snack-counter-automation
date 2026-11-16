/** A scripted month at both offices. Shared by the terminal demo (demo.ts) and the browser demo (web/). */

import { FakeCalendar, FakeChat, FakeClock, FakeHr, type ChatMessage } from "./fakes.ts";
import { Money } from "./money.ts";
import { monthlyReport, type MonthlyReport } from "./report.ts";
import { InMemoryRefillRepository } from "./repository.ts";
import { HOME_OFFICE, OFFICES, PAYROLL_CURRENCY, VOLUNTEERS } from "./sample.ts";
import { RefillService } from "./service.ts";

export interface DemoStep {
  title: string;
  at: Date;               // simulated time when the step finished
  messages: ChatMessage[];
  notes: string[];        // what happened that isn't a chat message (errors, HR state)
}

export interface DemoResult {
  steps: DemoStep[];
  report: MonthlyReport;
}

export async function runDemo(): Promise<DemoResult> {
  const clock = new FakeClock(new Date("2026-11-16T08:00:00Z")); // Monday, 09:00 in Oslo
  const chat = new FakeChat();
  const hr = new FakeHr(PAYROLL_CURRENCY);
  const calendar = new FakeCalendar(HOME_OFFICE);
  const repo = new InMemoryRefillRepository();
  const service = new RefillService({ offices: OFFICES, volunteers: VOLUNTEERS, repo, chat, hr, calendar, clock });

  const steps: DemoStep[] = [];
  let shown = 0;
  let current: DemoStep | null = null;
  const finish = () => {
    if (!current) return;
    current.messages = chat.messages.slice(shown);
    current.at = clock.now();
    shown = chat.messages.length;
    steps.push(current);
  };
  const step = (title: string) => {
    finish();
    current = { title, at: clock.now(), messages: [], notes: [] };
  };
  const note = (text: string) => current!.notes.push(text);
  const receipt = new Uint8Array([1, 2, 3]);

  step("Lars reports the Oslo box empty, and Sofie reports it too");
  const oslo = await service.reportEmpty("OSL", "lars");
  await service.reportEmpty("OSL", "sofie");
  note(`Only one refill exists: ${oslo.id}`);

  step("Ingrid doesn't answer within 2 hours");
  clock.advanceHours(2);
  await service.tick();

  step("Lars and Sofie both press Accept at the same moment");
  const results = await Promise.allSettled([service.accept(oslo.id, "lars"), service.accept(oslo.id, "sofie")]);
  results.forEach((r, i) => note(`${["Lars", "Sofie"][i]}: ${r.status === "fulfilled" ? "committed" : `refused (${r.reason.message})`}`));

  const buyer = (await repo.get(oslo.id)).buyerId!;
  step("Lars buys snacks and uploads the receipt");
  clock.advanceHours(3);
  await service.submitReceipt(oslo.id, buyer, { amount: Money.of(840, "NOK"), receiptImage: receipt, items: ["Kvikk Lunsj", "Smash", "apples"] });

  step("Arjun from Bengaluru is visiting Oslo; the Oslo box empties again");
  for (let d = 17; d <= 21; d++) calendar.set("arjun", `2026-11-${d}`, "OSL");
  clock.advanceDays(1);
  const visit = await service.reportEmpty("OSL", "sofie");
  note(`Offered to ${(await repo.get(visit.id)).offeredTo}: in the Oslo office today, with no recent refills (Lars is still waiting on HR)`);

  step("Arjun accepts, buys, and claims in NOK; HR pays them in INR");
  await service.accept(visit.id, "arjun");
  await service.submitReceipt(visit.id, "arjun", { amount: Money.of(1150, "NOK"), receiptImage: receipt, items: ["Freia", "Bugles"] });
  const claim = hr.claims.get((await repo.get(visit.id)).claimId!)!;
  note(`HR claim ${claim.id}: ${claim.request.amount} from ${claim.request.employeeId}, paid out in ${claim.payoutCurrency}`);
  note("Charged to the Oslo budget, in NOK");

  step("Bengaluru box empty; Meera accepts but spends over the cap");
  const blr = await service.reportEmpty("BLR", "arjun");
  const blrBuyer = (await repo.get(blr.id)).offeredTo!;
  await service.accept(blr.id, blrBuyer);
  await service.submitReceipt(blr.id, blrBuyer, { amount: Money.of(3400, "INR"), receiptImage: receipt, items: ["Parle-G", "banana chips", "masala peanuts"] });
  note("Nothing sent to HR yet: waiting for the coordinator");

  step("Priya, the coordinator, approves it");
  await service.approvePurchase(blr.id, "priya");

  step("HR approves two claims; the third is still pending after 10 days");
  clock.advanceDays(5);
  const claims = [...hr.claims.keys()];
  hr.approve(claims[0]);
  hr.approve(claims[2]);
  await service.tick();
  clock.advanceDays(6);
  await service.tick();

  step("Monthly report");
  finish();

  const report = monthlyReport({
    month: "2026-11",
    offices: OFFICES,
    refills: await repo.all(),
    reportingCurrency: "NOK",
    fxRates: { INR: 0.125 }, // illustrative rate; in production, the finance team's month-end rate
  });
  return { steps, report };
}
