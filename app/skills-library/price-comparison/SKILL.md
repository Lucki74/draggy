---
name: price-comparison
description: Compares options on total cost including delivery, fees, running costs and warranty, using live sources, and presents a clear table. Use when the user asks to compare prices, which option is cheaper overall, or to find the best deal.
---

# Price comparison

## Goal

Show the real cost of each option over the period that matters to the user, checked on the day, so the choice does not rest on a headline price.

## When to use

- The user is choosing between products, plans, shops or services.
- A price looks low but the user suspects extra charges.
- Fitting the purchase into a month's money is `use_skill` with `budget-planner`.

## Steps

1. Ask with `ask_user` what is being bought, must-have features, the budget, the country, and how long the user will keep or use it.
2. Find three to six options with `search_web`. Prefer shops and makers the user can verify, and open each page with `read_url`.
3. Record for each option: the exact model or plan, the price on the day, currency, tax treatment, delivery cost and time, and the link.
4. Add one-off costs: setup, installation, accessories, activation fees and import charges.
5. Add running costs over the period of use: subscription, consumables, energy, insurance and servicing.
6. Add the terms: warranty length, return window, who pays for a return, and cancellation rules for plans.
7. Check that the options match on the must-have features. Mark those that do not, and do not rank them with the others.
8. Compute the total cost over the period with `run_command` if the sums are long, and show the arithmetic.
9. Check for introductory prices that rise later, and show the cost after the offer ends.
10. Read a few independent reviews for reliability, noting source and date. Treat them as a signal and mention small sample sizes.
11. Make a table sorted by total cost, with a note on the best value and the cheapest, if they differ.
12. State the date and time of the check, since prices move, and tell the user to confirm at checkout.

## Gotchas

- Comparing list prices and ignoring fees.
- Quoting prices from memory.
- Overlooking return terms.
- Comparing different sizes or specs as if equal.
- Missing that a price needs a membership or coupon the user does not have.
- Mixing prices with and without tax.
- Trusting a shop's own claim of a discount from a higher price.
- Using a price from another country's site.

## Output

A comparison table with total cost, terms and sources, the date checked, and a short recommendation with the reason.
