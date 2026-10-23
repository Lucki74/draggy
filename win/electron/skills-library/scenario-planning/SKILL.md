---
name: scenario-planning
description: Builds best, base and worst cases for a business decision from stated assumptions and shows how the key results change between them. Use when the user asks to model scenarios, wonders what happens if sales drop, or wants to plan for different outcomes.
---

# Scenario planning

## Goal

Show how a decision or a shock plays out under a small number of clearly defined cases, so the user knows which assumptions matter most. The cases are illustrations built from the user's inputs. They are not forecasts or investment advice, and major decisions should be reviewed with a licensed advisor.

## When to use

- The user faces a decision such as a hire, a price change, or a new location.
- The user wants to know how bad things get if one input moves.
- A single-purpose cost calculation is `use_skill` with `break-even-analysis`.

## Steps

1. Ask with `ask_user` for the decision or question, the time frame, and the two or three results that matter most, such as cash at the end, profit and headcount.
2. Collect the base inputs with `read_file` or chat: revenue, costs, volumes, prices, timing. Record the source of each.
3. List the assumptions that drive the results and rank them by how uncertain they are and how much they move the result.
4. Choose the two or three drivers to vary. Do not vary everything at once.
5. Define the three cases in words first: what is true in the best case, the base case and the worst case. Give each driver a number in each case, and ask the user to approve them.
6. Build the model with `run_code`, one function that takes the assumptions and returns the key results. Run it for each case.
7. Show a table of the cases side by side, and the change from base for each result.
8. Run a one-driver-at-a-time test to show which assumption moves the result the most.
9. Define early signs the user can watch to learn which case is happening, and a date to re-run.
10. Check that the base case matches the user's own current numbers before showing the others.
11. Write the story of each case in two sentences so a partner can follow it.
12. Keep a log of each version of the assumptions.

## Gotchas

- Changing many assumptions together, so no one knows what caused the difference.
- A worst case that is only mildly bad. It must be a case the user would struggle with.
- A best case that quietly assumes everything goes right at once.
- Presenting the base case as the most likely outcome.
- Probability labels with no basis. Do not attach percentages unless the user supplies a reason.
- Forgetting timing: a bad quarter in the middle can matter more than the year-end total.
- Using the same growth rate for every line of a model, which hides the real drivers.
- Skipping the check that the model reproduces last period's actuals.

## Output

The assumptions table, the side-by-side results, the driver ranking, the watch list and the re-run date. Label everything as an illustration from supplied inputs.

Close with the question the user still needs to answer.
