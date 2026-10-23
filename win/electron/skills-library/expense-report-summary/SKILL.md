---
name: expense-report-summary
description: Summarises an expense list by category, person and period, flags outliers and missing receipts, and keeps totals reconciled to the source. Use when the user asks to summarize expenses for a month or team, prepare an expense report, or see what was spent and on what.
---

# Expense report summary

## Goal

Turn an expense list into a short report a manager can read and approve, with totals that match the source. The report states facts about spending. It does not decide what is reimbursable or deductible, which depends on company policy and tax rules to be checked with a professional.

## When to use

- A month, trip or team's expenses need a summary.
- The user has a categorized export and wants totals and flags.
- Sorting raw transactions into categories is `use_skill` with `expense-categorizer`.

## Steps

1. Load the file with `read_file`. With `run_code`, print the columns, row count, date range and the sum of the amount column. Keep that source total.
2. Ask with `ask_user` for the period, the currency, the policy limits the user wants flagged, and who reads the report.
3. Check the data: dates inside the period, amounts that parse, duplicate rows (same date, vendor and amount), blank categories.
4. If several currencies appear, ask for the rates and their source and date. Do not look up a rate and apply it silently.
5. Compute totals by category, by person and by week or month with `run_code`.
6. Flag outliers: amounts over a limit, the top five single expenses, vendors that repeat often, weekend or out-of-period dates.
7. List rows with no receipt reference, if a column exists.
8. Reconcile: the sum of every breakdown equals the source total. Print both.
9. Write the report: headline total, breakdown tables, flags and open questions for the approver.
10. Save with `create_file` as Markdown or CSV if asked.
11. Offer a one-paragraph narrative for the approver that mentions only facts in the tables.
12. Mark any amount converted from another currency and the rate used.

## Gotchas

- Totals that differ from the source because of dropped blank rows or duplicate merges.
- Counting refunds as positive spend, or leaving them out.
- Applying today's exchange rate to old expenses without saying so.
- Calling a flag an error. A high amount may be legitimate; ask.
- Hiding personal names in a report that will be shared more widely than the user intends.
- Mixing expense dates and payment dates between months.
- Counting an advance and its later settlement as two expenses.
- Rounding each line before summing, which drifts away from the source total.

## Output

The report with the reconciliation line at the top, the tables, the flagged items with reasons and the open questions. Do not label anything approved.

Keep the page short: headline first, detail below.
