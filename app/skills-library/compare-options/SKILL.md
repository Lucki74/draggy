---
name: compare-options
description: Compares products, services, tools or choices side by side against the criteria that matter to the user, with a scored table and a clear recommendation. Use when the user is deciding between options, asks which of two things to pick, or wants the best choice for their needs.
---

# Compare options

## Goal

Help the user choose. A good result puts concrete facts side by side against their priorities and names a best pick, with a fallback for a different priority.

## When to use

- The user is deciding between products, services, tools or plans.
- The user asks "which should I pick" or "what's the best X for me".
- For open-ended idea generation before any options exist, use `use_skill` with `brainstorm`.

## Steps

1. Understand the decision. What is being chosen, and what for ("a laptop for video editing on a budget of 1,200")? Note hard constraints (budget, compatibility, location, deadlines, must-haves) and what matters most. If the user did not say, infer 4 to 6 sensible criteria and state them with rough weights.
2. Gather facts. Use the user's information first. For products and services with prices, specs or plans, use `search_web` and `read_url` when available: official pages for specs and prices, independent reviews for real-world performance. Note the date prices were found. Without web access, say your information may be out of date, especially prices. With more than about five options, shortlist first and explain what was excluded and why.
3. Build a table with options as columns and criteria as rows, and concrete values in the cells ("14 h battery", "49 per month") instead of ticks. Where helpful, add a score from 1 to 5 per criterion and a weighted total, and show the weights.
4. Recommend. Name the best option for this user's stated priorities and why, in two to three sentences. Name the best alternative for a different priority ("if battery life matters more than price, choose B"). Mention deal-breakers and hidden costs: subscriptions, lock-in, accessories, running costs.

## Gotchas

- Popularity is not a criterion. Do not favour an option because it is well known.
- Prices and specs go stale quickly. Date them, or flag that they may have changed.
- Ticks and "good" in cells hide the difference. Put the number or the fact in the cell.
- When options are close, or the answer hinges on something the user has not said, say so and ask that one question.
- Weights chosen after seeing the scores tend to justify a pick made in advance. Set them first.

## Output

The criteria and weights, the comparison table, then the recommendation, the alternative for a different priority, and any deal-breakers or hidden costs.
