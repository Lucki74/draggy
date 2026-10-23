---
name: task-decomposer
description: Breaks a large or fuzzy request into ordered steps, each with a done check, its dependencies and a rough size, and flags the steps that need a user decision before work starts. Use when the user says a task is too big, asks for the steps, or when a request would take many tool calls.
---

# Task decomposer

## Goal

Turn one big request into a list of small steps that can each be finished and checked. The order respects dependencies, the risky steps are visible early, and the first step is ready to start.

## When to use

- The request has several outcomes, files or systems in it.
- The user asks "where do I start" or "what are the steps".
- You catch yourself about to begin without knowing what finished looks like.
- For agreeing the plan and then running it, use `use_skill` with `plan-then-execute`.
- For long work that needs saved progress, use `use_skill` with `long-task-checkpoints`.

## Steps

1. State the end result in one sentence, as something that can be observed: "the export button downloads a CSV with all rows", not "improve export". If you cannot write that sentence, ask with `ask_user`.
2. Look at the current state before planning. Use `explore` or `search_files` to find the code, files or data involved, so the steps name real things.
3. List the outcomes the task needs, not the activities. Group by result: "login works", "data migrated", "docs updated".
4. For each outcome, list the steps to get there. A step should be small enough to finish in one sitting and to have one clear check.
5. Write the done check for every step: a command that passes, a file that exists, a page that shows a value, or a question the user answers yes to.
6. Mark dependencies. Note which steps block others and which can happen in any order. Put steps that unlock or de-risk the rest first, such as a spike on the unknown part.
7. Mark unknowns and decisions. Anything that needs the user's choice, a credential, an approval or outside information goes in a separate list with the question to ask.
8. Size each step as small, medium or large. Split any large step again.
9. Record the list with `update_plan` and start on step one. Revisit the list when a step shows the plan was wrong.

## Gotchas

- Splitting by file or layer ("backend, frontend, tests") hides when anything works. Split by outcome so each slice can be run.
- Steps with no done check slip into "mostly done". Write the check before the step.
- Planning everything in detail up front wastes effort when early steps change the picture. Detail the next few steps and keep the rest rough.
- A step that says "investigate" needs a limit and a question to answer, or it never ends.
- Do not hide the hard part at the end. Try it first.
- A list of twenty steps for a small task is overhead. Match the plan to the work.

## Output

- The end result sentence.
- The ordered steps with done checks, sizes and dependencies.
- Open decisions and questions for the user.
- Which step starts now.
