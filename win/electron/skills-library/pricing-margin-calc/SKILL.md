---
name: pricing-margin-calc
description: Computes margin and markup from cost and price in both directions and finds the price needed for a target margin after fees and discounts. Use when the user asks what price gives a target margin, how to calculate margin, or the difference between markup and margin.
---

# Pricing and margin calculator

## Goal

Give correct margin and markup figures and the price that reaches a target, with every deduction visible. This is arithmetic on the user's figures. It does not tell the user what to charge in the market, and the final pricing call is theirs.

## When to use

- The user knows cost and wants a price, or knows price and wants the margin.
- The user mixes up markup and margin.
- Choosing a pricing model or tiers is `use_skill` with `pricing-strategy-options`.

## Steps

1. Ask with `ask_user` for unit cost, planned price or target margin, and every deduction between list price and money received: discounts, marketplace or payment fees, shipping paid, returns allowance.
2. Confirm whether tax is included in the price. Ask for the rate only if the user wants it shown, and say the rate must be checked live with a professional.
3. Define the terms once in the answer: margin is profit divided by price, markup is profit divided by cost.
4. Compute with `run_code`: net price received, profit per unit, margin percent and markup percent.
5. For a target margin, solve for price: cost divided by one minus the margin, then adjust for percentage fees by dividing again by one minus the fee rate.
6. Show a small table of prices at several margins, so the user sees the spread.
7. Show the effect of a discount: the margin at 5, 10 and 20 percent off, and the extra volume needed to hold total profit.
8. Round only the final price, then recompute the margin from the rounded price.
9. Check by plugging the result price back into the margin formula.
10. Offer a table of cost against price at round numbers the user might choose.
11. State plainly whether the figures include tax, and say the user should confirm tax treatment with a professional.

## Gotchas

- Calling a 50 percent markup a 50 percent margin. A 50 percent markup is a 33 percent margin.
- Leaving out percentage fees, which scale with price and change the solve.
- Rounding early. Small rounding errors compound across a catalogue.
- Using list price in the margin when most sales are discounted.
- Setting margin without a check on competitor prices or demand, which the arithmetic does not cover. Suggest `search_web` for market prices if the user wants them.
- Mixing currencies between cost and price.
- Setting a price from margin alone when the market will not bear it.
- Mixing per-unit and per-order fees, such as a fixed fee per transaction.

## Output

A compact table with inputs, net price, profit, margin and markup, the price for the target, and the discount effect. Mark estimates and say the figures are arithmetic, not advice.

Show the formulas used so the user can copy them into a sheet.
