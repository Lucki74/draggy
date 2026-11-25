---
name: time-blocking
description: Places tasks into blocks of time on a calendar or weekly grid, sized from honest estimates, with buffers and protected time for deep work. Use when the user asks to time block their week, fit tasks into a calendar, or schedule focused work around meetings.
---

# Time blocking

## Goal

A schedule where each important task has a slot, the slots fit around fixed commitments, and there is slack for the unexpected. The user can follow it on a normal day.

## When to use

- The user has tasks and a calendar and wants them placed.
- The user wants protected time for deep work.
- For deciding what to do at all, use `use_skill` with `priority-matrix` first.
- For a single day with a must-do list, use `use_skill` with `daily-plan`.
- The user works in a shared calendar and needs blocks others will respect.

## Steps

1. Gather fixed items. Ask with `ask_user` for meetings, travel, school or childcare pickups and other commitments with exact times, plus working hours and any hours the user does not want to work. If they paste a calendar export file, open it with `read_file`.
2. Gather tasks with estimates. Ask for a size for each in minutes. If unsure, use 30, 60 or 90 and flag it as a guess. Split anything above two hours into sessions.
3. Compute free time per day: window minus fixed items. Then reserve 20 to 30 percent as slack. That reserve is not available for tasks.
4. Learn energy. Ask when the user thinks best, and place demanding tasks there. Without an answer, put them in the first free block of the morning.
5. Place the highest-impact tasks first. One block per task, with the task name and the end state ("outline done").
6. Group small tasks into a single admin block, for example messages, forms and errands, rather than scattering them.
7. Add buffers of 10 to 15 minutes after meetings and between different kinds of work.
8. Leave one block per week unassigned as overflow. Mark it clearly.
9. Check the plan. Add up planned minutes per day and compare with free time. Check that no two blocks overlap, travel is included and deadlines are met. Fix and recheck.
10. Offer to write it out as a table or an .ics-style list with `create_file`, depending on how the user will use it.

## Gotchas

- Blocks sized from hope run over and push everything. Use past experience and add margin for first-time work.
- Forgetting meals, commutes and context switches makes the plan fail by Tuesday.
- Back-to-back deep work for four hours is not realistic. Break it with a rest.
- A calendar with no flexibility becomes a source of guilt. State that moving blocks is normal and expected.
- Time zones and daylight saving changes shift fixed meetings. Check the dates if the week crosses one.
- Blocks without an end state become vague sessions. Name the deliverable.
- Review the plan on day two. Real use shows which estimates were wrong, and later weeks improve from that.

## Output

Put the day's first block at the top of the reply so the user knows where to begin.

A day-by-day table with Time, Block and End state, followed by a line for each day's free minutes versus planned minutes. Under 40 lines for a full week. Mention which tasks did not fit and where they can go.
