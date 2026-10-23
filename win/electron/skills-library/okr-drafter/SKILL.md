---
name: okr-drafter
description: Turns a direction or a set of goals into one to three objectives, each with a few measurable key results that have a baseline, a target and an owner. Use when the user asks to write OKRs, set quarterly objectives, or make vague goals measurable.
---

# OKR drafter

## Goal

A small set of objectives that say where to go, each backed by key results that show whether the team got there. A reader can tell at the end of the period if each key result was met.

## When to use

- The user is setting objectives for a quarter, half-year or project.
- The user has goals written as activities and wants them turned into results.
- For personal goals with habits and milestones, use `use_skill` with `goal-planner`.
- For turning a chosen goal into tasks and owners, use `use_skill` with `project-plan`.
- The user needs to cascade a company goal into a team goal and keep the link visible.

## Steps

1. Ask with `ask_user` for the period, the team or person, the direction in plain words, and any existing goals or last period's results. Read files they point to with `read_file`.
2. Write each objective as a short, qualitative statement of an outcome: what is different at the end. No numbers in it. Keep to one to three.
3. For each objective, list candidate key results. A key result is a measurable change in a number, such as a rate, a count, a time or a level of satisfaction, not a task.
4. Test each key result with three checks: does it have a baseline and a target, could an outsider say yes or no at the end, and does the team control most of it. Rewrite those that fail.
5. Ask for baselines. If the user does not have a current number, make "measure the baseline" a first-week action and mark the target as provisional. Do not make up a number.
6. Set targets at an ambitious but plausible level. Ask what level would feel like clear success and what would feel like a miss. Record the scoring rule if the user wants one.
7. Limit to three key results per objective. Cut the weakest.
8. Assign an owner to each key result and a check-in rhythm, for example every two weeks.
9. List the main initiatives that are expected to move each key result. Keep them out of the key result lines.
10. Review the draft: objectives read as outcomes, key results as numbers, initiatives as work.

## Gotchas

- Tasks written as key results ("launch the new site") confuse output with outcome. Ask what changes because of the launch, and measure that.
- Targets with no baseline cannot be scored. Mark them provisional and measure first.
- Objectives with a number inside belong in the key results.
- Too many objectives spread effort thin. If everything is priority one, nothing is.
- Metrics that can be hit by gaming (page views, tickets closed) need a guard. Pair them with a quality measure.
- Do not invent benchmarks. If the user wants an industry figure, use `search_web` and cite the source.
- Do not tie key results to pay or performance reviews unless the user says that is the rule. It pushes people to set safe targets.

## Output

End with the single check-in date when the first progress reading is due.

For each objective: the statement, then a table of Key result, Baseline, Target, Owner. Below it, Initiatives and Check-in rhythm. About one page. Offer to save with `create_file`.
