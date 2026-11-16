/** Step-through view of the demo month. Runs the real service code in the browser. */

import { runDemo, type DemoStep } from "../src/demoScript.ts";
import type { ChatMessage } from "../src/fakes.ts";
import type { MonthlyReport } from "../src/report.ts";
import { OFFICES, VOLUNTEERS } from "../src/sample.ts";

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function el(tag: string, className = "", text = ""): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

const nameOf = (id: string) => VOLUNTEERS.find((v) => v.id === id)?.name ?? id;
const officeOf = (id: string) => OFFICES.find((o) => o.id === id)!;
const homeTz = (userId: string) => officeOf(VOLUNTEERS.find((v) => v.id === userId)?.homeOfficeId ?? "OSL").timeZone;

function clockAt(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(at);
}

function message(m: ChatMessage, at: Date, fresh: boolean): HTMLElement {
  const row = el("article", `msg${fresh ? " fresh" : ""}`);
  row.append(el("div", "avatar", "🤖"));
  const body = el("div", "body");
  const meta = el("div", "meta");
  const tz = m.kind === "channel" ? officeOf(m.to).timeZone : homeTz(m.to);
  meta.append(el("span", "who", m.kind === "direct" ? `Snack bot → ${nameOf(m.to)}` : "Snack bot"), el("span", "when", clockAt(at, tz)));
  body.append(meta, el("p", "", m.text));
  row.append(body);
  return row;
}

function renderReport(report: MonthlyReport): HTMLElement {
  const wrap = el("div");
  wrap.append(el("h2", "", `Monthly report: ${report.month}`));
  const cards = el("div", "cards");
  for (const o of report.offices) {
    const card = el("div", "card");
    card.append(el("h3", "", o.officeName));
    const used = Math.min(100, Math.round((o.spent.minor / o.budget.minor) * 100));
    const bar = el("div", "bar");
    const fill = el("div", "fill");
    fill.style.width = `${used}%`;
    bar.append(fill);
    card.append(el("p", "big", `${o.spent}`), el("p", "muted", `of ${o.budget} · ${o.remaining} left`), bar);
    const dl = el("dl");
    const row = (k: string, v: string) => dl.append(el("dt", "", k), el("dd", "", v));
    row(`In ${report.reportingCurrency}`, `${o.spentInReportingCurrency}`);
    row("Refills", `${o.refills}`);
    row("Buyers", Object.entries(o.refillsByBuyer).map(([k, n]) => `${nameOf(k)} ×${n}`).join(", ") || "none");
    row("Items", Object.keys(o.items).join(", ") || "none");
    row("Still owed to buyers", `${o.awaitingReimbursement}`);
    row("Avg days to reimburse", o.avgDaysToReimburse?.toFixed(1) ?? "n/a");
    if (o.overCapRefills.length) row("Over cap", o.overCapRefills.join(", "));
    if (o.rejectedClaims.length) row("Rejected by HR", o.rejectedClaims.join(", "));
    card.append(dl);
    cards.append(card);
  }
  wrap.append(cards);
  const rates = Object.entries(report.fxRates).map(([c, r]) => `1 ${c} = ${r} ${report.reportingCurrency}`).join(", ");
  const total = el("div", "total");
  total.append(el("strong", "", `Total: ${report.totalSpent}`), el("span", "muted", ` of ${report.totalBudget} · rate ${rates} (example rate)`));
  wrap.append(total);
  return wrap;
}

function show(steps: DemoStep[], report: MonthlyReport, index: number): void {
  const step = steps[index];
  byId("title").textContent = step.title;
  byId("time").textContent = `${clockAt(step.at, "Europe/Oslo")} in Oslo · ${clockAt(step.at, "Asia/Kolkata")} in Bengaluru`;
  byId("counter").textContent = `${index + 1} / ${steps.length}`;
  byId<HTMLButtonElement>("prev").disabled = index === 0;
  byId<HTMLButtonElement>("next").disabled = index === steps.length - 1;

  const notes = byId("notes");
  notes.replaceChildren(...step.notes.map((n) => el("li", "", n)));

  const feeds = { OSL: byId("feed-OSL"), BLR: byId("feed-BLR"), dm: byId("feed-dm") };
  Object.values(feeds).forEach((f) => f.replaceChildren());
  steps.slice(0, index + 1).forEach((s, i) => {
    for (const m of s.messages) {
      const feed = m.kind === "direct" ? feeds.dm : feeds[m.to as "OSL" | "BLR"];
      feed.append(message(m, s.at, i === index));
    }
  });
  for (const f of Object.values(feeds)) {
    if (!f.children.length) f.append(el("p", "empty muted", "No messages yet"));
    f.scrollTop = f.scrollHeight;
  }

  const reportEl = byId("report");
  const last = index === steps.length - 1;
  reportEl.hidden = !last;
  reportEl.replaceChildren(...(last ? [renderReport(report)] : []));

  document.querySelectorAll<HTMLLIElement>("#steps li").forEach((li, i) => {
    li.classList.toggle("current", i === index);
    li.classList.toggle("done", i < index);
  });
}

const { steps, report } = await runDemo();
let index = 0;
const go = (i: number) => {
  index = Math.max(0, Math.min(steps.length - 1, i));
  show(steps, report, index);
};

byId("steps").replaceChildren(
  ...steps.map((s, i) => {
    const li = el("li");
    const button = el("button", "", s.title) as HTMLButtonElement;
    button.type = "button";
    button.addEventListener("click", () => go(i));
    li.append(button);
    return li;
  }),
);
byId("prev").addEventListener("click", () => go(index - 1));
byId("next").addEventListener("click", () => go(index + 1));
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") go(index + 1);
  if (e.key === "ArrowLeft") go(index - 1);
});
go(0);
