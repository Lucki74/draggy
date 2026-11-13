---
name: habit-tracker-design
description: Designs a small habit tracker for one to three habits, with a cue, a minimum version, a simple layout and a rule for missed days, then builds it as a file the user can open. Use when the user asks to build a habit tracker, track a routine, or stick to a new habit.
---

# Habit tracker design

## Goal

A tracker the user will still fill in after three weeks. It tracks few habits, makes each one small enough to do on a bad day, and records only what is needed to see a pattern.

## When to use

- The user wants a sheet, table or note for tracking daily or weekly habits.
- The user has tried trackers before and dropped them.
- For goals with milestones and a deadline, use `use_skill` with `goal-planner`.
- For a one-off checklist rather than a daily habit, use `use_skill` with `checklist-builder`.
- The user wants to review a month of tracking data and adjust the habits.

## Steps

1. Ask with `ask_user` which habits, why each matters, how often, and what the user used before. Limit the first version to one to three habits. If they list eight, ask which one they would keep if only one.
2. Define each habit as an observable action: "walk 15 minutes", not "be more active". Check that someone watching could say yes or no.
3. Set a minimum version for bad days, such as "put on shoes and walk to the corner". The minimum counts as done.
4. Choose a cue: an existing event the habit follows ("after morning coffee"). Write it as "After X, I will Y in place Z".
5. Choose the layout with the user: a grid with days across and habits down, a weekly table, or a plain list in a note. Pick the one that fits where they already look every day.
6. Decide what to record. Default is done or not done. Add a second column for a number only if the number changes what they do (minutes, pages).
7. Write the missed-day rule: one miss is allowed, never two in a row, and the user restarts with the minimum version. Put it on the tracker itself.
8. Add a weekly check: three counts (days done per habit), one line on what got in the way, one tweak.
9. Build the file with `create_file`: a spreadsheet with a date row and checkboxes, or markdown if the user prefers text. Include a totals row.
10. Confirm the first day: tell the user to fill in today's cell after doing the habit.

## Gotchas

- Starting with five habits fails. Start with one and add a second after three stable weeks.
- A target that needs perfect streaks breaks at the first miss. Use the never-miss-twice rule.
- If the tracker takes longer than the habit, simplify it.
- Counting streaks alone rewards chains over benefit. Look at the weekly total instead.
- Habits without a cue rely on memory. Attach every one to an existing event.
- Do not set health targets such as weight or calories. Keep to actions, and send medical questions to a professional.
- Moving house, travel or illness breaks routines. Plan a restart rule for such weeks in advance.

## Output

Show the tracker's first row filled in as an example so the user sees how it looks in use.

A brief design (habit, minimum version, cue for each, plus the missed-day rule), then the tracker file path. Describe the layout in two lines. Keep the chat reply under 15 lines.
