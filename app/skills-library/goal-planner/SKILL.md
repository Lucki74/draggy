---
name: goal-planner
description: Turns a personal or professional goal into specific milestones, weekly habits, planned-for obstacles and a simple way to track progress. Use when the user wants to set goals, build a habit, plan a change, stay accountable, or asks how to reach something by a date.
---

# Goal planner

## Goal

A plan the user can start today: a concrete goal with a measure and a date, scheduled weekly actions, and a way to notice when it slips.

## When to use

- The user wants to set a goal, build a habit, plan a change or stay accountable.
- For a learning plan built around study sessions and exams, use `use_skill` with `study-plan`.
- For a work project with tasks and owners, use `use_skill` with `project-plan`.
- For money goals centred on a monthly budget, use `use_skill` with `budget-planner`.

## Steps

1. Make the goal concrete. Turn the wish into a specific outcome with a measure and a date: "get fit" becomes "run 5 km without stopping by 30 September". Check that it is within the user's control and realistic for their situation. If it is very ambitious, suggest a first milestone.
2. Ask why it matters to them, in one question with `ask_user`. The answer is used later to stay motivated.
3. Build the plan:
   1. Milestones: 3 to 5 checkpoints between now and the date.
   2. Weekly actions: the habits and tasks that move toward the next milestone, scheduled ("Tuesday and Thursday 7:00, 25-minute run"). Small and specific beats ambitious and vague.
   3. Starting step: something the user can do today in under 15 minutes.
   4. Obstacles: the 3 most likely, each with an if-then plan ("If it rains, I do the indoor workout video").
   5. Tracking: one simple measure recorded weekly.
   6. Review: a short weekly set of questions: what worked, what did not, what to change.
4. Keep the tone encouraging and practical. Treat missed weeks as information and adjust the plan.

## Gotchas

- For health goals involving medical conditions, pregnancy, eating disorders or major weight change, recommend involving a doctor.
- A goal outside the user's control ("get promoted") needs rewriting into actions they do control.
- Vague weekly actions fail. If an action has no day and time, it is not scheduled.
- A plan with no obstacles listed breaks at the first disruption. Write the if-then plans.
- Preachy wording makes people drop the plan. Missed weeks are data.

## Output

The goal statement, milestones with dates, the weekly plan, obstacles with if-then plans, and the first step in bold. Offer a tracking sheet as an .xlsx with `create_file`, with columns Week, Planned, Done, Measure, Notes.
