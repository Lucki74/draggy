---
name: break-even-analysis
description: Calculates the sales volume or revenue where costs are covered from fixed costs, price and variable cost, and shows how it moves when inputs change. Use when the user asks for a break-even point, how many sales cover costs, or whether a product can pay for itself.
---

# Break-even analysis

## Goal

Find the point where revenue equals total cost and show how sensitive that point is to the inputs. The result informs a planning discussion. It is not investment advice, and the user should check major decisions with an accountant or licensed advisor.

## When to use

- The user is launching or repricing a product and wants the volume needed.
- The user wants to know what a new fixed cost would require in extra sales.
- Profit per unit across channels is `use_skill` with `unit-economics`.

## Steps

1. Ask with `ask_user` for the period (a month or a project), fixed costs in that period, price per unit, and variable cost per unit.
2. Check each input is for the same period and currency. Convert annual figures to the period.
3. Ask whether any cost is semi-fixed, such as a staffing step at higher volume. Split it into ranges if so.
4. Compute contribution per unit as price minus variable cost. If it is zero or negative, stop and say there is no break-even at that price.
5. Compute break-even units as fixed costs divided by contribution per unit, and break-even revenue as units times price. Use `run_command` and round units up.
6. Build a sensitivity grid: price at minus 10, 0 and plus 10 percent against fixed costs at the same changes.
7. Compare break-even volume with the volume the user expects, if known, and report the margin of safety as a percentage.
8. State the time it takes to reach break-even at the user's expected monthly volume.
9. Recheck: at the break-even units, revenue minus fixed minus variable is zero.
10. Offer a chart description or a small table of profit at several volumes around the point.
11. Ask what happens to fixed costs if volume doubles, to test the fixed assumption.

## Gotchas

- Using the list price when discounts and marketplace fees reduce what is received.
- Treating costs that step up with volume as fixed.
- Reporting 412.3 units as 412. Partial units round up to cover costs.
- Leaving out the owner's pay, which makes the point look easier than it is.
- A single point estimate with no range, which hides the risk.
- Ignoring that a ramp-up period delays reaching the point.
- Assuming sales are even through the month when they are seasonal.
- Using break-even revenue for a product mix without weighting the mix.

## Output

The break-even units and revenue, the sensitivity grid, the margin of safety and a short list of assumptions. Label the figures as estimates from the user's inputs.

State the volume in the unit the user actually counts, such as orders or hours.
