---
name: runway-calculator
description: Estimates how many months current cash lasts from burn figures, with a low, base and high case and the assumptions shown. Use when the user asks about runway, how long the cash will last, or how to calculate burn rate.
---

# Runway calculator

## Goal

Give the user a defensible estimate of months of cash remaining, with ranges and the assumptions behind them. It is a planning estimate based on the user's records. It is not a prediction, and it is not advice on fundraising or investment, which belong with a licensed advisor.

## When to use

- The user wants months of cash left at the current spending level.
- The user is testing how a hire or a cut changes the date cash runs out.
- A week-by-week view of cash is `use_skill` with `cash-flow-plan`.

## Steps

1. Ask with `ask_user` for the current cash balance as of a stated date, and the source: bank statement or books.
2. Collect monthly cash in and cash out for at least the last three months with `read_file` or from chat.
3. Compute gross burn (total cash out) and net burn (cash out minus cash in) per month with `run_code`. Show both.
4. Ask about known changes: planned hires, price changes, contracts ending, one-off payments due, annual bills.
5. Build three cases: low (burn rises or income falls), base (recent average with known changes) and high (burn falls or income rises). State the numbers changed in each.
6. Compute months of runway as cash divided by net burn for each case, and the calendar month cash would run out.
7. Add the committed payments that fall inside the window as dated lines, because they can end runway sooner than the average suggests.
8. Show how runway changes if net burn changes by 10 percent either way.
9. Recheck by stepping the base case month by month and confirming the balance hits zero where the division says.
10. Offer to repeat the calculation monthly with new actuals, and list the three figures to update.
11. Show what monthly net burn would have to be for runway to reach the date the user wants.

## Gotchas

- Using last month's burn as the steady state when it was unusually high or low.
- Using revenue instead of cash received. Late payers shift cash by weeks.
- Leaving out taxes, annual subscriptions and insurance that land in one month.
- Quoting a single figure such as 14 months with no range.
- Treating expected funding or a credit line as cash on hand.
- Net burn of zero or negative, which means the formula returns no end date; say that instead of a huge number.
- Including one-off income in the average income used for burn.
- Forgetting that payroll taxes and benefits come on top of wages.

## Output

The three cases in a table, the run-out month for each, the committed payments, and the weakest assumption. Label it an estimate and suggest reviewing it with an accountant.

Mention the date of the cash balance in the same sentence as the result.
