---
name: home-maintenance-schedule
description: Creates a seasonal schedule of home upkeep tasks from the home type, appliances and climate, with reminders by month. Use when the user asks for a home maintenance schedule, what to check around the house, or a yearly upkeep plan.
---

# Home maintenance schedule

## Goal

Give the user a short calendar of upkeep that fits their home: what to check, how often, and in which month, so small faults get caught before they grow.

## When to use

- The user bought or rented a home and wants a routine.
- Something failed and the user wants to avoid a repeat.
- Costing the upkeep over the year is `use_skill` with `budget-planner`.

## Steps

1. Ask with `ask_user` for the home type, age, heating and cooling systems, garden or balcony, appliances, and the climate or region.
2. Ask who owns which tasks. Renters often handle only part, and the landlord or building handles the rest.
3. Ask for the model names of the main appliances and find their manuals with `search_web`. Use the maker's intervals when they exist, and name the source.
4. List recurring tasks by frequency: monthly, quarterly, twice a year, yearly. Typical examples are smoke alarm tests, filter changes, drain checks, gutter clearing, seal checks and servicing of the heating system.
5. Adjust for the climate: freeze protection before winter, ventilation in damp seasons, shade and cooling checks before summer.
6. Place each task in a month, spreading the load so no month has more than a few tasks.
7. Mark tasks that need a qualified professional, such as gas, electrical work and roof work, and tell the user to hire a licensed person for them.
8. Mark safety tasks first: smoke and carbon monoxide alarm tests, escape routes, and the location of the main water and power switches.
9. Add a record for each task: last done, next due, who did it and the cost, kept in a simple table.
10. Build reminders with `create_file` as a calendar-ready list, one row per task and date.
11. Add a small kit list: torch, basic tools, spare filters and bulbs, and the numbers of local trades.
12. Suggest a yearly review each autumn to adjust the plan and the budget.

## Gotchas

- A generic list that ignores the home type.
- Tasks with no month attached.
- Skipping the manufacturer manual for each appliance.
- Doing gas or electrical work without a qualified person.
- Doing roof or ladder work alone.
- Forgetting tasks that belong to the landlord, and not reporting faults in writing.
- Putting every task in the same weekend.
- Keeping no record, so warranty claims lack proof of servicing.

## Output

A month-by-month schedule, a task record table, a list of jobs for professionals and a basic kit list.
