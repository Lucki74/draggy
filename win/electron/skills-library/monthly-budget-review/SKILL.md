---
name: monthly-budget-review
description: Compares last month's actual spending with the user's budget, explains the gaps and sets one or two adjustments for next month. Use when the user asks to review their budget, wants to know if they stuck to it, or does a monthly money check.
---

# Monthly budget review

## Goal

Give the user a calm, factual look at how the month went against their own plan, and end with one or two changes they chose. This is planning help based on figures they supply. It is not financial advice, and for decisions about debt, investing or taxes they should speak to a licensed professional.

## When to use

- The month just ended and the user has a budget and a list of spending.
- The user feels the budget does not work and wants to see why.
- Building a first budget from scratch is `use_skill` with `budget-planner`.

## Steps

1. Ask with `ask_user` for the budget (categories and amounts) and the month. Load the actual spending with `read_file` or take pasted totals.
2. With `run_code`, total the actuals by category and print the budget, the actual and the difference for each. Show the sum of all categories next to the sum of the source.
3. Mark each gap as fixed (rent), flexible (food) or irregular (car repair, gift). Say which gaps come from a single item.
4. Ask for the reason behind the three largest gaps. Do not guess the reason.
5. Check income: was it as expected? Note any income that was late or one-off.
6. Look at the last three months if data exists, and tell the user which gaps repeat and which were a one-time event.
7. Ask the user which one or two categories they want to change. Offer options, such as moving the amount or changing the habit, and let them pick.
8. Update the budget for next month with the chosen changes, and add a line for known irregular costs coming up.
9. Set a date for the next review, and one number to watch during the month.
10. Offer a one-line summary the user can paste into their notes: month, total over or under, the change chosen.
11. Ask whether anything in the month changed the plan for the year, such as a new regular cost.

## Gotchas

- Treating a one-off bill as a habit and cutting the wrong category.
- Moving the budget after the fact so every line shows green. Keep the original next to the actual.
- Forgetting costs that land once a year. Spread them over twelve months in the plan.
- Counting transfers to savings or between accounts as spending.
- Comparing a 28-day month with a 31-day month without saying so.
- Judging the user's choices. Describe what happened and ask what they want to change.
- Reviewing only the overspent lines. Underspent ones may point to a category that was budgeted too high.
- Treating the review as a verdict on the user. It is a tune-up.

## Output

A table of budget, actual and difference by category, a short note per large gap, the one or two changes the user chose and the next review date. No product suggestions and no promises about outcomes.

Keep the whole answer to one screen.
