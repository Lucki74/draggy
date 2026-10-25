---
name: plan-then-execute
description: Writes a short plan, gets the user's approval on risky or ambiguous parts, then carries it out step by step while keeping the plan current and reporting when reality departs from it. Use when the user asks for a plan before changes, or when the task touches many files or can't be undone.
---

# Plan then execute

## Goal

Make the intent visible before acting. The user sees what will change and approves the risky parts, then work proceeds in the agreed order, and any change to the plan is said out loud.

## When to use

- The task edits many files, runs migrations, deletes data or touches shared systems.
- The user says "plan first", "show me before you change anything" or similar.
- The request has more than one reasonable reading.
- For splitting a large goal into checkable steps, use `use_skill` with `task-decomposer` first.
- For tiny, reversible edits, skip the ceremony and just do them.

## Steps

1. Explore before planning. Use `explore`, `search_files` and `read_file` to learn where the change goes and what depends on it. A plan written blind is a guess.
2. Write the plan with `update_plan`: five to eight steps, each naming files or commands, in order. Put the check that proves each step next to it.
3. Mark the risky steps: deletions, overwrites, anything that cannot be undone, network calls that change remote state, and anything outside the working folder.
4. Show the plan and ask with `ask_user` for approval on the marked steps. State what is assumed, offer the default, and let the user change the scope. If every step is safe and reversible, say the plan and proceed.
5. Start executing. Set the first step in progress, do it, run its check and mark it complete before moving on. One step in progress at a time.
6. Keep changes inside the plan. If you spot an adjacent problem, add it to a "later" list instead of fixing it now.
7. When a step fails or the situation differs from the plan, stop and update the plan. Say what changed and why. If the change adds risk or scope, ask again before continuing.
8. After the last step, run the overall check from the plan, such as the test suite or a manual run.
9. Report against the plan: each step done, changed or skipped, with the evidence for the checks.

## Gotchas

- A plan that only restates the request adds nothing. Name files, commands and checks.
- Asking for approval on every small step wears the user out. Ask on the risky ones.
- Approval of the plan is not approval of everything. A new destructive step needs its own yes.
- Do not carry on silently after the plan broke. A plan that no longer matches the work misleads the reader.
- Plans for unknown code are weak. Read first, then plan.
- Keep the plan in sync. A stale list showing a finished step as pending confuses everyone.

## Output

- The plan as approved, and any changes made along the way.
- Each step's status and the check that proved it.
- Items put on the "later" list.
- What could not be verified.
