---
name: bill-calendar
description: Builds a calendar of bill due dates against pay dates so the user sees tight weeks and can adjust timing. Use when the user asks for a bill calendar, wants to know when bills are due, or needs to organize payment dates across the month.
---

# Bill calendar

## Goal

Lay every recurring bill on one timeline next to the dates money arrives, so the user can see which weeks are tight and which due dates could move. The skill plans timing only. It does not advise on credit, loans or products.

## When to use

- The user has many bills with different due dates.
- Money feels short in certain weeks even though the monthly total is fine.
- Finding forgotten recurring charges is `use_skill` with `subscription-audit`.

## Steps

1. Ask with `ask_user` for the pay dates and amounts, and how often the user is paid. Ask about irregular income and how it usually arrives.
2. Collect the bills: name, amount, due date, frequency, how it is paid, and whether the due date can be changed. Read a statement or list with `read_file` if given.
3. Include bills that are not monthly: quarterly, yearly, seasonal. Ask what is due in the coming twelve months.
4. Adjust each date for weekends and holidays. Ask how many days a payment takes to arrive, and plan to pay before the due date.
5. Place everything on a month view with `run_command` or by hand: per date, the bills due and the money in. Show a running balance by week using the user's opening balance, if given.
6. Mark the tight weeks: where bills exceed money in plus the balance.
7. Propose timing changes that the user can ask for, such as moving a due date closer to payday, where the biller allows it. Tell the user to confirm options on the biller's own page.
8. Add reminders: list the dates three days before each large bill.
9. Save with `create_file` as a Markdown or CSV calendar and say how to update it when a bill changes.
10. Offer a rolling twelve-month view if the user has irregular bills.
11. Ask which bills are fixed in amount and which vary, and mark the variable ones with an estimate.

## Gotchas

- Missing yearly and quarterly bills, which cause the surprise months.
- Planning on the due date instead of the arrival date.
- Ignoring that direct debits may fail if the balance is short that day.
- Assuming a due date can be moved. Some cannot.
- Showing only monthly totals, which hides the weekly squeeze.
- Forgetting a bill that is paid by a partner or from another account.
- Listing variable bills at last month's amount with no range.
- Forgetting that a due date moves when the month is shorter.

## Output

A date-ordered table of bills with pay dates, a weekly balance view if possible, the tight weeks, timing changes to ask about and the reminder list.

Add a column for the account each bill is paid from.
