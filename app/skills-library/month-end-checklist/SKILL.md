---
name: month-end-checklist
description: Builds a month-end close checklist from the user's own tools and routines, in order, with an owner and evidence for each step. Use when the user asks for a month-end close checklist, wants to know what to do at month end, or needs steps to close the books.
---

# Month-end checklist

## Goal

Give a small business a repeatable close routine: the same steps in the same order every month, each with an owner, a due day and proof it was done. The list organizes the work. Accounting rules and filing duties depend on place and entity, so the user should confirm them with an accountant and the live official guidance.

## When to use

- The user keeps their own books and wants a routine.
- A bookkeeper joins and needs a documented process.
- Summarizing the month's spending is `use_skill` with `expense-report-summary`.

## Steps

1. Ask with `ask_user` for the accounting tool, who does the books, bank and card accounts, whether sales happen on several platforms, payroll, inventory, and the user's reporting needs.
2. Read any existing notes with `read_file`.
3. Draft the steps in dependency order: collect bank, card and platform statements; import or enter transactions; match each account to its statement; chase missing receipts.
4. Add the sales steps: confirm all invoices are issued, check open invoices, record platform payouts and fees.
5. Add the cost steps: enter bills received, accrue known unpaid costs if the user uses accruals, review recurring subscriptions.
6. Add payroll and loan steps if they apply, with the check that balances match statements.
7. Add the review steps: scan for odd amounts, uncategorized lines, and duplicates; compare each major line to last month and explain big moves.
8. Add the cut-off rule: the day the month is locked and what happens to items that arrive later.
9. Add the output steps: save the reports the user needs, back up the file, note open issues for next month.
10. For each step, set the owner, the usual day (for example day 3 of the next month), and the evidence, such as a reconciled statement or a saved report.
11. Save with `create_file` as a Markdown checklist the user can copy each month.
12. Offer a lighter weekly checklist for the user's busiest accounts.
13. Ask which reports the user must hand to an accountant, and put those last.

## Gotchas

- Starting before the bank statement is complete, which forces rework.
- No cut-off rule, so late invoices slip between months.
- Steps without an owner. Someone must tick each box.
- Reconciling to the books instead of to the statement.
- Forgetting platform fees, which reach the bank net of sales.
- Locking the period and then editing it silently. Record changes after lock as notes.
- Closing every month with the same steps even when something new, such as a loan, appears.
- Doing the review on the same day as data entry, where mistakes hide.

## Output

A numbered checklist with owner, day, and evidence columns, the cut-off rule, and a short list of items the user must confirm with their accountant.

Add a note of what to do first if a month was missed.
