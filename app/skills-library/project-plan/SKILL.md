---
name: project-plan
description: Turns a goal into a project plan with scope, milestones, tasks with owners and estimates, dependencies, risks and a timeline, saved as a spreadsheet or document. Use when the user needs to plan a project, an event, a launch, a move or any multi-step undertaking, or asks for a timeline or work breakdown.
---

# Project plan

## Goal

Give the user a plan they can run: a measurable goal, milestones with dates, tasks small enough to estimate, a visible critical path and the main risks.

## When to use

- The user wants to plan a project, event, launch, move or other multi-step effort.
- The user asks for milestones, a task list, a timeline or a work breakdown.
- For a personal goal with habits rather than deliverables, use `use_skill` with `goal-planner`.
- For a learning schedule, use `use_skill` with `study-plan`.

## Steps

1. Define the project. Ask only for what you cannot infer:
   - Goal: what done looks like, measurably ("new website live with 12 pages and a contact form by 1 June").
   - Scope: what is included and what is explicitly excluded.
   - Constraints: deadline, budget, people available, fixed dates.
   - Stakeholders: who decides, who does the work, who must be kept informed.
2. Split the work into 3 to 7 phases or milestones, each with a clear deliverable.
3. Split each phase into tasks of roughly half a day to five days. For each task give an owner (or role), an estimate and what it depends on.
4. Find the critical path, the chain of dependent tasks that sets the end date, and point it out.
5. Add buffer: about 15 to 25% on uncertain estimates, plus a buffer before the deadline.
6. List the top 5 risks, each with likelihood, impact and a mitigation or early warning sign.
7. Suggest a simple rhythm: a weekly check-in, who updates the plan, and how decisions and changes are recorded.
8. Offer to save the plan with `create_file`:
   - an .xlsx with columns ID, Phase, Task, Owner, Estimate (days), Depends on, Start, End, Status;
   - and/or a .docx or .pdf brief with goal, scope, milestones and risks.

## Gotchas

- Tasks over about five days hide unknowns. Split them until each can be estimated.
- A plan without a stated critical path gives no hint which slip moves the end date.
- Estimates without buffer are the usual cause of a missed deadline.
- Weekends: skip them when computing dates unless told otherwise, and say you did.
- Use YYYY-MM-DD for dates in the spreadsheet so they sort and parse.

## Output

Milestones with dates, then the task list, then risks. Say which file you saved, if any, and state the date assumptions you made.
