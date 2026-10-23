---
name: estimate-work
description: Estimates the effort of a feature or change as a range built from broken-down parts, with assumptions, unknowns and confidence stated. Use when the user asks how long something will take, wants a rough size, or asks to estimate a task or feature.
---

# Estimating work

## Goal

Give an honest range the user can plan around, built from the parts of the work rather than a gut number. The estimate shows its assumptions, so a changed assumption changes the number in a way people can follow.

## When to use

- "How long will this take", "estimate this", "is this a day or a week".
- A plan or ticket needs a size before it is scheduled.
- Choosing between options where effort is a deciding factor.
- Splitting the work into tickets is the real ask: use `task-breakdown`.
- Too big for the deadline: after estimating, use `scope-cutter`.

## Steps

1. Pin down what is being estimated: the done state, in one or two sentences. If the finish line is unclear, call `ask_user` for it. Estimating a fuzzy target gives a fuzzy number.
2. Ask what unit and audience the estimate has: hours for one person, working days for a team, or a rough size (small, medium, large). Match it.
3. Look at the code. Use `search_files`, `read_file` and `explore` to find the files, modules and tests involved and how similar changes were done before. Count what you find: files touched, call sites, tests to update.
4. Break the work into parts of about a half day or less where possible: design, implementation per area, tests, migration, docs, review feedback, release steps. Use `update_plan` to keep the list visible.
5. Give each part a low and a high figure. The high figure is what happens when the first guess is wrong, not a worst case disaster. Wide ranges on a part mean it holds an unknown.
6. Mark unknowns separately: anything you could not verify (an API behaviour, a library limit, unfamiliar code). Check what you can with `read_url` or `search_web`. For unknowns that stay open, propose a `tech-spike` and estimate that instead.
7. Add the work people forget: review and rework, test fixes, merging, config and deploy changes, waiting on other people. State them as lines, not as hidden padding.
8. Sum the lows and the highs. Do not average. Report the range and a confidence level (high, medium, low) with the reason.
9. List the assumptions that move the number most, in order. Say what would change the estimate, for example "if the API has no batch call, add one to two days".
10. Offer follow-up: reduce the range by resolving unknowns, or cut scope to hit a date.

## Gotchas

- One number gets treated as a promise. Give a range, and say which end is likely.
- Estimating only the coding. Tests, review, integration and release often equal the coding time in a real codebase.
- Anchoring. If the asker says "that's a quick one, right?", estimate from the parts first and compare after.
- Summing tiny optimistic parts understates the total. Small tasks overrun by a larger share than large ones, so keep a visible line for integration.
- Unfamiliar territory has a learning cost that a sizing of the "typical" work misses. If you or the team have not done this before, widen the range and say so.
- Estimates from a past project are evidence only when the work is truly similar. Check how it was similar, and do not invent figures for previous work you have not seen.

## Output

A table of parts with low and high, a total range, a confidence rating, then the top assumptions and open unknowns. Under 30 lines. State plainly that this is an estimate of effort, not of calendar delivery, unless the user gave availability.
