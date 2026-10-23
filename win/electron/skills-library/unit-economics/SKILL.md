---
name: unit-economics
description: Works out what one unit or one customer earns after variable costs, using the user's figures, and states what each number assumes. Use when the user asks about unit economics, profit per customer or order, or contribution margin.
---

# Unit economics

## Goal

Produce a clear per-unit or per-customer picture: revenue, variable cost, contribution, and what it costs to win the customer. The analysis explains the numbers the user gave. It is not advice on investing or fundraising, and the user should review decisions with a qualified advisor.

## When to use

- The user wants to know whether each order or customer makes money.
- The user is comparing two products or channels on profit per unit.
- Finding the volume that covers fixed costs is `use_skill` with `break-even-analysis`.

## Steps

1. Ask with `ask_user` what the unit is: an order, a subscriber, a client, a job. Fix the definition before computing.
2. Collect inputs with `read_file` or from chat: price after discounts, variable costs per unit (materials, fees, shipping, support), and the period covered.
3. Separate variable costs from fixed ones. Anything that does not change per unit stays out of the contribution calculation.
4. Compute contribution per unit and as a percentage of price with `run_code`.
5. For customers who buy repeatedly, ask for purchase frequency and how long customers stay, from the user's records. State the sample size.
6. Add acquisition cost per customer if the user has it, and compare contribution over the customer's life to that cost.
7. Test sensitivity: show the result when price falls 10 percent and when the largest variable cost rises 10 percent.
8. Check the arithmetic by recomputing one unit by hand.
9. Say which input is weakest and what record would firm it up.
10. Compare two products or channels side by side if the user has more than one.
11. Explain each ratio in one sentence so the user can repeat it to a partner.

## Gotchas

- Dropping payment processing fees and returns from variable cost.
- Using a lifetime figure from a few months of data. Short history gives unreliable lifetime estimates.
- Averaging across products with very different margins. Compute them separately.
- Allocating rent or salaries per unit and calling it variable.
- Counting free trials or refunds as revenue.
- Quoting a ratio without the period and currency.
- Counting one-off setup effort as if it repeats for every unit.
- Dropping customers who left from the lifetime average.

## Output

A small table with price, variable costs, contribution and margin, then the sensitivity cases and the weakest assumption. Keep figures labelled as estimates from the user's data.

Include a note on which numbers are measured and which are assumed.
