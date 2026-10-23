---
name: debt-payoff-plan
description: Lays out payoff timelines for the user's debts under a chosen order and extra payment, using the balances and rates the user supplies. Use when the user asks how to pay off debts, wants to compare snowball and avalanche, or asks how long it takes to clear cards or loans.
---

# Debt payoff plan

## Goal

Show how long each debt takes to clear and how much interest accrues under one or two payoff orders, using the user's real figures. This is arithmetic for planning. It is not financial advice, and it does not recommend loans, balance transfers or products. For decisions the user should speak to a licensed advisor or a non-profit credit counsellor.

## When to use

- The user lists several debts and wants a payoff order.
- The user wonders what an extra payment each month would change.
- Reviewing the budget that funds payments is `use_skill` with `monthly-budget-review`.

## Steps

1. Ask with `ask_user` for each debt: name, balance, annual interest rate as on the statement, and minimum payment. Ask how the rate is compounded if the statement says.
2. Ask for the total monthly amount the user can put toward all debts, and whether it will stay constant. Confirm the user will not add new charges to the cards.
3. Check the inputs with `run_code`: that each minimum covers at least the monthly interest. If it does not, say that the balance will not fall on that payment.
4. Simulate month by month with `run_code`: pay all minimums, then send the extra amount to the target debt. When a debt clears, add its payment to the next target.
5. Run two orders: smallest balance first, and highest rate first. Also run the minimums-only baseline.
6. For each run, report months to debt-free, total interest paid and the month each debt clears.
7. Show the difference in plain terms, and say that the right order also depends on how motivated the user feels, which a calculation cannot tell.
8. Test sensitivity: re-run with extra payments 20 percent lower and higher.
9. Recompute one debt by hand for the first three months to confirm the simulation.
10. Offer a one-page schedule the user can print, with the payoff month of each debt.
11. List what to update when a statement arrives: balance, rate, new minimum.

## Gotchas

- Dropping the minimum payment of debts that are not the target.
- Using the advertised rate instead of the one on the statement, or ignoring fees.
- Promotional rates that expire: ask for the end date and model the change.
- Assuming a constant extra amount when income varies.
- Leaving the emergency buffer at zero while paying debt, which pushes the next surprise back onto a card.
- Treating the result as a promise. Real balances change with spending and rate moves.
- Counting interest that is charged daily as monthly without noting the approximation.
- Overlooking a debt owed to family, which has no statement but still needs a plan.

## Output

A comparison table of the runs, the payoff order with dates, and the assumptions. Keep the tone neutral and avoid judging how the user got here.

Say plainly that the figures change if rates or payments change.
