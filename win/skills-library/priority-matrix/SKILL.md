---
name: priority-matrix
description: Sorts a list of tasks or ideas on an impact and effort grid, adds urgency where it applies, and says what to do now, schedule, hand off or drop. Use when the user asks to prioritize a list, wants an Eisenhower matrix, or asks what matters most among several options.
---

# Priority matrix

## Goal

Turn a flat list into a ranked decision. Every item gets a placement and a verdict, and at least some items leave the list.

## When to use

- The user has more items than time and wants help choosing.
- The user asks for an Eisenhower matrix or an impact and effort grid.
- For choosing between a few named options with criteria, use `use_skill` with `compare-options`.
- For one day's order, use `use_skill` with `daily-plan`.
- The user has a backlog of ideas, errands or requests and needs a cut line.

## Steps

1. Get the list. Ask with `ask_user` for the items and one line on the goal they serve. If the list is in a file, use `read_file`. Without a goal, impact cannot be judged, so ask for it.
2. Clean the list. Merge duplicates, split items that hide several jobs, and write each as a verb phrase.
3. Choose the axes. Default to impact on the stated goal (high or low) and effort (high or low). Use urgency and importance when the user asked for the Eisenhower version.
4. Score each item twice, in separate passes: impact first, then effort or urgency. Keep scores to high, medium or low and write a few words of reason for each.
5. Place items in the four cells. For impact and effort: high impact and low effort is do now, high impact and high effort is plan as a project, low impact and low effort is batch or fill gaps, low impact and high effort is drop.
6. For the Eisenhower version: urgent and important is do, important not urgent is schedule, urgent not important is hand off or shorten, neither is drop.
7. Check the top cell. If more than a third of the items sit there, the scoring is too generous. Re-rank by asking which single item the user would keep if only one could be done.
8. Order the do-now items and name the first one.
9. Show the user the placements and ask which they disagree with. Move items on their input and say why the verdict changed.

## Gotchas

- Everything ends up urgent when the deadline is someone else's anxiety. Ask what happens, concretely, if the item waits a week.
- Effort estimates are guesses. If an item's effort is unknown, mark it and plan a small test to size it.
- Impact is relative to a goal. A task can be high impact for one goal and zero for another, so name the goal at the top.
- A drop column that stays empty means the exercise did nothing. Push for at least one drop or defer.
- Do not hide dependencies. A low-impact item that blocks a high-impact one moves up.
- Two people scoring the same list rarely agree. When the user is part of a group, score separately and discuss only the gaps.
- Re-run the matrix when the goal changes. Old placements do not carry over.

## Output

State the goal used for scoring in the first line, since every placement depends on it.

A table with columns Item, Impact, Effort, Reason, Verdict, sorted with do-now first, followed by the one-line next action. If the user wants a visual grid, draw four text cells. Offer a spreadsheet through `create_file` only when the list is long.
