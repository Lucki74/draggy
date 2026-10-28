---
name: savings-goal-plan
description: Works out how much to set aside each period to reach a savings goal by a date and checks that the amount fits the user's budget. Use when the user asks how much to save each month, wants a plan to save for a goal, or sets a target amount by a date.
---

# Savings goal plan

## Goal

Turn a goal into a monthly amount and a short schedule, then test it against the user's real budget. This is simple planning arithmetic with no promised returns. It is not financial advice, and the user should speak to a licensed advisor about where to keep or invest money.

## When to use

- The user names a goal, an amount and a date, such as a deposit, a trip or a course.
- The user cannot reach the goal on time and wants to see the options.
- A buffer for emergencies is `use_skill` with `emergency-fund-plan`.

## Steps

1. Ask with `ask_user` for the goal, the target amount, the date, what is already saved, and how often the user is paid.
2. Count the number of pay periods until the date with `run_command`, and compute the plain amount needed per period: the remaining sum divided by the periods.
3. Ask whether the money will earn interest. If yes, ask for the rate the user has been quoted and use it only as a labelled scenario. Do not assume one. If unsure, plan with zero interest.
4. Ask for the current monthly surplus, or load the budget with `read_file`. Compare the needed amount with the surplus.
5. If the plan does not fit, show three options: a later date, a smaller target, or a larger contribution. Compute each.
6. Build a month-by-month table of contribution and running total.
7. Check the price of the goal: ask whether it may rise, and add a margin only if the user wants one.
8. Add a rule for windfalls and missed months, chosen by the user.
9. Set a check-in date, and what the user will do if they are more than one month behind.
10. Offer to track progress in a small table the user updates monthly.
11. Show what happens to the date if the user skips two contributions.

## Gotchas

- Assuming interest or growth the user has not confirmed. Present it only as a scenario.
- Choosing an amount the budget cannot sustain, so the plan fails in month three.
- Forgetting that the goal's price can rise, or that fees apply on the savings account.
- Counting the starting amount twice.
- Mixing weekly and monthly pay periods.
- Using the same pot for two goals. Name each pot.
- Treating the goal date as fixed when it is flexible. Ask which of date or amount can move.
- Ignoring that income may drop in some months.

## Output

The needed contribution, the fit against the budget, the options if it does not fit, a schedule table and the check-in date. State that no return is guaranteed.

End with the first contribution date.
