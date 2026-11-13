---
name: feature-prioritization
description: Scores candidate features on criteria tied to stated goals, shows the trade-offs and dependencies, and recommends a build order with the scoring visible. Use when the user asks which feature to build first, wants to prioritize a backlog, or asks for a RICE or similar scoring.
---

# Feature prioritization

## Goal

A ranked list with the reasoning on the page. The user sees why one feature is ahead of another, can change a score and watch the order move, and knows which items depend on guesses.

## When to use

- The user has more feature ideas than capacity and needs an order.
- The user wants a scoring model applied to a backlog in a file or pasted list.
- For a quick impact and effort sort of any list, use `use_skill` with `priority-matrix`.
- For the roadmap that follows, use `use_skill` with `product-roadmap-outline`.
- For a decision among a few named options, use `use_skill` with `compare-options`.
- Product, sales and engineering disagree on the order and need a shared method.

## Steps

1. Ask with `ask_user` for the goal for this period and the list of candidates. If the list is in a file, open it with `read_file`. Without a goal, scores are arbitrary, so settle that first.
2. Normalize the list. One feature per row, same level of detail, a short description of the user-visible change. Split large items into pieces that can be scored alone.
3. Choose a model. For most teams use RICE: Reach (how many people in a period), Impact (effect per person on the goal, on a small fixed scale), Confidence (how sure, as a percentage) and Effort (person-weeks). Use a simpler value-versus-effort sort if data is thin. Explain the choice in a line.
4. Define each scale before scoring. Write what 1, 2 and 3 mean for Impact in this product. Fix the period for Reach. Record the definitions at the top.
5. Collect inputs from evidence: usage data, support counts, interview notes, sales requests. Read what the user supplies. Mark each number as measured or estimated. If a number is missing, use a low-confidence guess and flag it.
6. Compute the score for each row. For RICE it is Reach times Impact times Confidence divided by Effort. Show inputs and results in one table.
7. Review the order against judgment. Ask the user whether the top item feels right. A mismatch usually means a criterion is missing, such as risk, legal need or strategic fit. Add it as a note or override with a stated reason.
8. Handle dependencies and bundles. If A needs B, schedule B first. Combine items that are only worth it together.
9. Run a sensitivity check: change the two weakest-evidence inputs by a wide margin and see if the top three change. Report which rankings are stable.
10. Recommend the order for the next period and list the items to cut or revisit.

## Gotchas

- Scores look exact and are not. Ranges and the sensitivity check keep the table honest.
- Effort estimates made by one person run low. Ask the people who will build.
- Reach counts anyone touched. Impact must be tied to the goal, or a popular but trivial item wins.
- Mandatory items (legal, security, outages) skip the scoring. Place them first and say why.
- Loud customers inflate Reach. Check the request against the base.
- Re-score each period. Scores from last quarter reflect last quarter's goals.
- When the list is in a spreadsheet, return the scores in the same column layout so the user can paste them back.

## Output

A definitions block, a table of Feature, Reach, Impact, Confidence, Effort, Score, Notes sorted by score, the sensitivity note, and the recommended order with dependencies.
