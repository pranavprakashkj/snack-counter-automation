# Snack Counter Automation: Design

**What "automate" means here.** A chat bot backed by a small service. It turns "the box is empty" into one named person's job within minutes and stops a second person from buying. It sends the reimbursement claim to HR the moment a receipt is uploaded, then chases it. The budget check and the monthly report both come from the same refill records. People still buy the snacks, and the HR system and payroll are left as they are.

## 1. From "empty" to "reimbursed"

```
reportEmpty ─► awaiting_buyer ─accept─► committed ─receipt─► purchased ─► claim_submitted ─► reimbursed
                 │   ▲ decline / 2h no answer   │ release / 24h              │ over cap          └─► claim_rejected
                 │   └── next volunteer, or ◄───┘ no receipt                 ▼
                 │       open call                                     needs_approval ─coordinator─► purchased
                 ▼
           on_hold_budget ── new month ──► awaiting_buyer
```

1. **Report.** Anyone types `/snacks empty` in chat. If that office already has an open refill, the reporter is told who is handling it, and no second refill is created.
2. **Budget check.** The service works out this month's remaining budget for that office. If it can't cover the minimum purchase (300 NOK / 500 INR), the refill goes on hold, and the coordinator and channel are told. It resumes automatically when the next month starts.
3. **Offer.** The fairest volunteer who is at that office today gets a DM with Accept/Decline buttons and a spend cap: the office's typical maximum, or what's left if that's less. The channel sees "Ingrid has been asked".
4. **Hand-over.** A decline, or no answer within 2 hours, moves the offer to the next person. If nobody is left, it becomes an open call in the office channel, and the first to accept gets it. The open call is retried every 4 hours, and people who passed are asked again the next day.
5. **Commit.** Accepting reserves the cap against the budget and posts "Lars is refilling, no one else needs to buy". With no receipt after 24 hours, the buyer is released, the reservation is freed and the refill is offered to someone else.
6. **Receipt.** The buyer uploads a photo, the amount and the items. If the amount is within the cap, the claim (employee ID, amount, currency, description, image) goes to HR immediately. If it's over the cap, the coordinator must approve it first.
7. **Reimbursement.** A scheduler polls HR. Approval marks the refill reimbursed and tells the buyer. A rejection tells the buyer and coordinator. From day 10 onwards, the coordinator gets a daily reminder until HR responds.

## 2. Parts and the data each keeps

| Part | Keeps |
|---|---|
| **Office config** | Currency, time zone, monthly budget, minimum purchase and cap per refill (from the typical range in the brief), coordinator. |
| **Volunteer list** | Company login (assumed to be the HR employee ID), home office, active flag. |
| **Refill record** (the only stateful part) | State, version, reporter and time, current offer and its deadline, who passed today, buyer, commit time and deadline, spend cap, amount, items, receipt, HR claim ID, submit and resolve times, reminder time, event history. |
| **Refill service** | Nothing of its own. It applies the rules, then saves the refill with a conditional write, and sends chat messages only after the save succeeds. |
| **Buyer selection** | Nothing. A pure function over refill history and today's calendar. |
| **Budget** | No separate balance. Spent and reserved amounts are computed from refill records per office and per local month. |
| **Chat / HR / calendar adapters** | Nothing. Simulated in `src/fakes.ts`. |
| **Monthly report** | Generated on demand from refill records, plus a NOK exchange rate supplied for the month. |

## 3. How each problem is prevented

- **The box sits empty because everyone assumes someone else will refill it.** One named person is asked within minutes, and is publicly known to have been asked. The timeouts guarantee it moves on if they don't act, the open call catches days when nobody on the list is in, and a budget hold is announced rather than silent.
- **Two people buy on the same day.** An office can have only one open refill: a duplicate report returns the existing one. Committing is a conditional write on the refill's version, so if two people accept at the same moment, exactly one succeeds. The channel announces who is buying. After a timeout releases someone, their late receipt is refused (and they are told to contact the coordinator).
- **A few people do most refills and wait weeks.** Selection skips anyone still owed money, then picks whoever has the fewest refills in the last 90 days, then whoever's last refill was longest ago. Claims are submitted automatically on upload rather than whenever someone gets round to it. The service can't make HR faster, but it can make slow claims visible: daily reminders after 10 days, and the report shows money owed and average days to reimburse.
- **Nobody knows spend or what gets eaten.** Every purchase records amount, items and timing. The monthly report shows per office: spent against budget, buyers, items, money still owed, hours from empty to refilled, over-cap and rejected claims, and one combined total in NOK.

**Currencies.** The budget follows the counter, and the reimbursement follows payroll. A Bengaluru employee visiting Oslo buys in NOK, which is charged to Oslo's NOK budget, and the claim is sent in NOK. HR pays them in INR, as the brief says. Nothing ever adds NOK to INR except the report total, which uses an explicit monthly rate. Budget months use each office's local time zone, so 19:00 UTC on 30 November is November in Oslo but December in Bengaluru.

## 4. Trade-offs

- **Budget computed from records, not a separate balance.** There's no second number to drift out of sync, and at roughly 20 refills a month the cost is negligible. Manual adjustments such as refunds would need a proper ledger.
- **Asking one person, rather than posting to everyone.** It's slower when someone ignores it (up to 2 hours), but it makes one person accountable. Posting to everyone is what causes "someone else will do it" today, so it's only the fallback.
- **Reserving the whole cap on commit.** Near the end of the month this can briefly block budget that the buyer won't use, but the cap a buyer is promised is always covered.
- **Rejected claims still count as spend.** The snacks were bought and eaten. The coordinator resolves these by hand.
- **In-memory store and a polling scheduler.** The repository's two atomic operations match what a real database does (a unique index on open refills per office, and versioned updates), so it can be replaced without changing the rules.
- **Duplicate HR claims.** A short lease stops the service from sending the same claim twice. But if HR creates a claim and its reply is lost, a retry would duplicate it. That needs a reference HR can deduplicate on (asked in QUESTIONS.md).
- **Who is in the office today** depends on calendar data. If that data is poor, a decline or timeout still corrects it, at the cost of a slower hand-over.

## 5. Deliberately not built

- **Sensors or scales on the box.** For two boxes, a chat command is cheaper and good enough.
- **Receipt OCR.** The buyer types the amount, and HR checks the receipt anyway.
- **Currency conversion for reimbursements.** HR already pays in payroll currency.
- **Tracking stock or individual snacks, or snack voting.** The item list on each receipt answers "what do we buy" well enough to start.
- **A web dashboard or admin UI.** The monthly report and chat messages cover the needs in the brief.
- **Splitting a purchase across buyers, or partial refills.** One refill means one buyer and one receipt.
- **Worth raising instead of building:** a company card or petty cash per office would remove the reimbursement wait entirely.
