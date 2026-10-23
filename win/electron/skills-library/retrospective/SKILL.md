---
name: retrospective
description: Guides a team or solo retrospective on a sprint, project or period, groups what went well and badly into themes, and ends with a few actions that have owners and dates. Use when the user asks to run a retro, review a sprint, or work out what to change after a project.
---

# Retrospective

## Goal

Learn from a finished period of work and leave with one to three changes that someone owns. The session stays about the process and the system, not about blaming people.

## When to use

- A sprint, project, launch or quarter has ended and the user wants a structured look back.
- A solo user wants to review a personal project the same way.
- For a single incident with an outage or failure, use `use_skill` with `postmortem-writer`.
- For a personal weekly look back, use `use_skill` with `weekly-review`.
- The user wants a format for a remote team that cannot meet in person.

## Steps

1. Set the scope. Ask with `ask_user` for the period, the team, and any events the group already knows about (a launch, a departure, a missed date). Ask whether they already have notes, tickets or a timeline; read them with `read_file` if so.
2. Build a simple timeline of the main events from the material. Mark highs and lows. Memory favors the last two weeks, and the timeline corrects that.
3. Collect input in three buckets: what worked, what did not, and what was confusing or surprising. If the user has team comments, sort them. If not, ask the user to answer for the team and say it is one view.
4. Group similar points into three to five themes and give each a plain name ("handoffs between design and dev").
5. For each theme, ask why, up to three times, until the cause is a process, rule, tool or habit that can change. Stop when you reach people's personal traits; that is not a cause you can fix.
6. Vote or rank. Pick the one to three themes that cost the most or recur most.
7. Write actions. Each action has a verb, an owner, a due date and a way to see it is done. Keep the list to three.
8. Review the actions from the last retro, if any. Mark done, dropped or still open. Note why those that stalled stalled.
9. Close with a one-line summary of the period and the actions.

## Gotchas

- A retro that produces ten actions produces none. Cap at three and finish them before the next one.
- Naming a person as the cause ends the honest talk. Rewrite as the system gap that let it happen.
- Skipping the review of last time's actions teaches the team that actions do not matter.
- Positive items are not filler. They show what to protect when changes are made.
- An action like "communicate better" is not an action. Rewrite it as a concrete habit or rule.
- The facilitator should not also be the loudest voice. Ask for written points first.
- A retro right after a stressful release gets raw emotion. If tempers are high, wait a day or two before running it.

## Output

Keep names out of the written record unless the person is credited for good work.

Sections: Timeline (short), What worked, What did not, Themes with causes, Actions (table with Action, Owner, Due, Done when), and Last retro's actions with status. Under one page. Offer to save with `create_file`.
