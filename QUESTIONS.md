# Questions for Framsikt

Each question notes what the code currently assumes, so the work isn't blocked waiting for an answer.

1. **Who is in the office on a given day?** Is there a desk-booking, leave or calendar system we can read?
   *Assumed:* a calendar we can query per person and day. If there isn't one, a decline or the 2-hour timeout still moves the refill on.
2. **Is the HR system's employee ID the same as the company login?**
   *Assumed:* yes.
3. **Does HR accept a claim in a currency other than the employee's payroll currency?** For example, a Bengaluru employee buying in Oslo claims in NOK and is paid in INR. Which exchange rate does HR use?
   *Assumed:* yes. HR does the conversion.
4. **Can a claim carry our own reference that HR deduplicates on, and how do we learn a claim's status: polling or a webhook?**
   *Assumed:* we poll for status, and the refill ID goes in the description. Without deduplication, a retry after a lost reply could create a duplicate claim.
5. **Who coordinates each office?** That is, who approves over-cap receipts and follows up with HR.
   *Assumed:* one named coordinator per office.
6. **Which currency and exchange rate should management's combined report use?**
   *Assumed:* NOK, at a month-end rate supplied by finance.
7. **Is the typical purchase range a rule or a guide?** Can a refill exceed 1 200 NOK / 3 000 INR with approval?
   *Assumed:* the top of the range is the default spend cap. Anything above it needs the coordinator's approval.
8. **Does unused budget roll over to the next month?**
   *Assumed:* no.
9. **If HR rejects a claim, does that purchase still count as spend?**
   *Assumed:* yes. The buyer and coordinator are told.
10. **Which chat tool is it (Slack, Teams, something else)?** This affects buttons and how the bot is deployed.
    *Assumed:* any tool that supports direct messages, channel posts and buttons.
11. **Why does HR typically reject claims?** If we know, we can validate before submitting.
12. **Would a company card or petty cash per office be an option?** It would remove the reimbursement wait entirely.
