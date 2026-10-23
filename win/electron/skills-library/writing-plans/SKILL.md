---
name: writing-plans
description: Turns an approved spec or request into an ordered implementation plan where every step names real files, has a verification check, and groups into checkpoints. Use when the user asks to plan an implementation, write a build plan, or break a spec into steps before coding.
---

# Writing implementation plans

## Goal

Produce a plan another person, or the same agent after a context reset, can execute without guessing. Each step points at real files and ends with a check that passes or fails. Checkpoints sit where the work can stop safely and be reviewed.

## When to use

- A spec, ticket or agreed idea exists and the next move is deciding the order of work.
- The change touches several files or layers and a wrong early step would be costly.
- The user says "plan this", "write a plan", "how should we build this".
- No spec yet and the intent is fuzzy: use `use_skill` with `brainstorming` or `spec-writing` first.
- Only splitting work into tickets with sizes: use `task-breakdown`.

## Steps

1. Read the spec once, fully. List its requirements as a numbered checklist you will map the plan back to. If a requirement is vague enough that two builders would code it differently, call `ask_user` with that one question.
2. Look at the code before naming anything. Use `search_files` and `read_file` to find the modules, functions, tests and config the change touches. Use `explore` when the area spans many directories. Record each path you confirmed exists.
3. Find the project's check commands (test, typecheck, lint, build) from `package.json`, a Makefile or CI config with `read_file`. Run the quickest one with `run_command` to learn whether the baseline is green.
4. Pick the thinnest vertical slice that proves the approach end to end. Make it step 1, even if it is ugly. Later steps widen it.
5. Order the remaining steps so each one leaves the project building and its tests passing. Put schema or interface changes before the code that uses them. Put risky or unknown work early.
6. For every step write: the goal in one sentence, files to change (existing paths marked, new paths marked new), the change in two or three lines, and a verification check as a command plus the expected result.
7. Insert a checkpoint after each group of steps that forms a reviewable unit. A checkpoint states what is now true, which tests cover it, and what the user can look at.
8. Map back: every requirement from step 1 must appear in at least one step. List any requirement left out and say why.
9. Record the plan with `update_plan` so it is visible while working. When the user wants it saved, save it with `create_file` under the project's docs or plans folder, matching existing naming.
10. Call out assumptions and open questions at the top, then ask the user to confirm before any step runs.

## Gotchas

- Ordering by file ("do all of the backend, then all of the UI") means nothing can be verified until the end. Order by what can be demonstrated.
- A plan that names functions from memory fails at step 3. Every path and symbol in the plan has to come from a lookup in this session.
- A verification of "check it works" is not a check. Write the command and the expected output, or the observable behaviour.
- Steps that bundle a refactor with a behaviour change hide regressions. Give the refactor its own step with the suite green before and after.
- Planning the happy path only leaves error handling, migrations and cleanup to improvisation. Give them steps.
- Plans rot while being executed. When a step reveals a wrong assumption, stop, fix the plan, and tell the user, instead of silently drifting.

## Output

The plan as a numbered list under the headings Assumptions, Steps (each with files and verification) and Checkpoints, followed by the requirement-to-step map and open questions. Keep each step under about six lines. End by asking which checkpoint to start with or whether to adjust. Do not start implementing in the same turn unless the user already asked for it.
