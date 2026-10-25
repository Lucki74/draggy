---
name: task-breakdown
description: Splits a feature or goal into small tasks that each have a done check, a rough size and explicit dependencies, sliced so each one delivers something working. Use when the user asks to break work down, split an epic into tickets, or list the subtasks for a goal.
---

# Breaking work into tasks

## Goal

A list of tasks small enough to finish in a sitting or a day, each one testable on its own, with the order and the blockers visible. Someone should be able to pick any unblocked task and start.

## When to use

- A feature, epic or goal is too large to start on.
- The user wants tickets, subtasks or a checklist for it.
- Work is being shared between people or sessions.
- The task order and verification detail matter more than tickets: use `writing-plans`.
- The question is only how long: use `estimate-work`.

## Steps

1. Read the source: the spec, issue or description with `read_file`. If the finish line is not clear, call `ask_user` for it before splitting anything.
2. Find the real shape of the work. Use `search_files`, `read_file` and `explore` to see which modules, tables, endpoints, screens and tests the change touches, so tasks map to actual places.
3. Define the thinnest end-to-end slice first: the smallest path through all layers that does something a user could see. This is task one.
4. Slice the rest vertically, by behaviour or case, not by layer. "User can reset a password by email" beats "build the endpoint", "build the form", "build the email" as three separate tasks that only work together.
5. Add the supporting tasks that vertical slices still need: schema migrations, feature flags, test fixtures, docs, cleanup of the old path. Give each its own entry.
6. For every task write: a verb-first title, one sentence of scope, a done check (the test, command or visible behaviour that proves it), and a size of small, medium or large. Split any large task again.
7. Mark dependencies by task number. Look for hidden ones: a task that needs a config value, a shared type, an API owned by someone else, or a decision not made yet. Put decisions as their own tasks.
8. Order the list so the first unblocked tasks reduce the biggest uncertainty. Note which tasks can run in parallel.
9. Put the list into `update_plan` for the session. If the user wants tickets or a file, write it with `create_file` in the format the team uses (check `.github` or `docs` with `list_directory` for templates).
10. Check coverage: every part of the goal from step 1 is traceable to at least one task, and no task lacks a done check.

## Gotchas

- Sizing by guess: a task written as "implement backend" with no done check will be days long and never provably finished. Split until the check is obvious.
- Layer-by-layer slicing delivers nothing until the last task lands, which hides integration problems to the end.
- Hidden dependencies block the first task someone picks. Scan for shared types, environment setup and approvals.
- Tasks that mix a refactor with a new behaviour cannot be reviewed or reverted cleanly. Separate them.
- Too many tiny tasks turns tracking into the work. Group anything under about an hour with its neighbour.
- Forgetting the unglamorous tasks (migration, rollout flag, removing the old code, updating docs) leaves the feature half shipped.

## Output

A numbered list: title, scope sentence, done check, size, depends on. Mark the first slice and the parallel groups. End with the coverage check result. Keep each task to three lines or fewer.
