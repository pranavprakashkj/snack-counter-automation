# Snack Counter Automation

Take-home for Framsikt. The design is in [DESIGN.md](DESIGN.md), and open questions with the assumptions made are in [QUESTIONS.md](QUESTIONS.md).

## Run

Requires Node 22.18 or later (TypeScript runs directly, with no build step).

```bash
npm install
npm test           # 41 tests
npm run typecheck
npm run demo       # a scripted month at both offices, printing the chat messages and the monthly report
npm run demo:web   # the same month in the browser, step by step, at http://localhost:5173
```

## Layout

| File | What it does |
|---|---|
| `src/service.ts` | Refill lifecycle: report, offer, accept / decline / release, receipt, approval, HR submission, timeouts (`tick`) |
| `src/selection.ts` | Choosing who buys |
| `src/budget.ts` | Budget check: spent, reserved, remaining, spend cap |
| `src/report.ts` | Monthly report, per office and combined in NOK |
| `src/repository.ts` | In-memory store with the two atomic operations the rules rely on |
| `src/domain.ts`, `src/money.ts` | Data types; money that refuses to mix currencies |
| `src/ports.ts`, `src/fakes.ts` | Chat, HR, calendar and clock interfaces and their simulated versions |
| `src/sample.ts` | Office config from the brief and sample volunteers |

## Where each rule is tested

| Rule | Test |
|---|---|
| Two people cannot both commit to the same refill | `lifecycle.test.ts` › only one person buys |
| A refill nobody completes is handed to someone else | `lifecycle.test.ts` › a refill nobody completes… |
| Claim goes to HR on upload, is retried and chased | `lifecycle.test.ts` › from purchase to reimbursed |
| Fair choice of buyer; only people in the office; visitors | `selection.test.ts` |
| Budget check, reservation, budget hold, over-cap approval, local month | `budget.test.ts` |
| Budgets and totals correct across both currencies | `budget.test.ts`, `money-report.test.ts` |
