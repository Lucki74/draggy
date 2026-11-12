---
name: weekly-review
description: Runs a weekly review that looks back at the week, clears loose ends and picks the few outcomes that matter for the next one. Use when the user asks for a weekly review, wants to plan next week, or asks what they got done this week and what to do about it.
---

# Weekly review

## Goal

Close the week and open the next one in about 20 minutes. The user ends with a short list of finished work, a cleaned set of open items, and three or fewer outcomes for next week that fit the time they have.

## When to use

- The user asks for a weekly review or wants to plan the coming week.
- The user feels behind and wants to see where the week went.
- For one day only, use `use_skill` with `daily-plan`.
- For fitting chosen tasks onto a calendar, use `use_skill` with `time-blocking`.
- The user finishes a project or a month and wants the same look back at a larger scale.

## Steps

1. Collect inputs. Ask with `ask_user` for the task list, notes, calendar entries or journal lines from the past week. If the user keeps them in files, open them with `read_file`. Do not invent activity the user did not report.
2. Look back. List what was finished, what moved but is not done, and what did not move. Keep each list to the items that mattered; skip trivia.
3. For each not-done item pick one verdict: carry forward, reschedule with a date, hand to someone, or drop. Dropping is a real option and should happen at least once in most weeks.
4. Capture loose ends. Ask for anything in the head, in open tabs or in half-answered messages, and turn each into an item with a next action.
5. Look ahead. Ask for fixed commitments next week (meetings, travel, deadlines) and estimate the free hours that remain. Free hours are the budget.
6. Choose up to three outcomes for the week. Each is a result with a finish line, such as "draft sent to Sam", not a topic such as "work on draft". Check that the estimated effort fits the free hours.
7. Name the first action for each outcome and the day it happens.
8. Ask one reflection question with `ask_user`: what worked this week and what to change. Record the answer in one line each.
9. Check the result against the Goal. If the outcomes need more hours than the budget, cut one.

## Gotchas

- A review that only lists tasks is a to-do dump. The value is in the verdicts: carry, reschedule, hand off, drop.
- Planning from the ideal week rather than the real calendar is the common failure. Count the meetings first.
- More than three outcomes means none gets finished. Extra items go on a "next in line" list, not the plan.
- Do not praise or scold. If the week went badly, find the cause (scope, interruptions, unclear task) and name it.
- Recurring items that slip every week need a redesign or a drop, not another carry-forward.
- Do not review a week with no data. Ask for notes first or run a short recall from the calendar.
- Review at a fixed time each week. A review done "when there is time" stops after a month.

## Output

Open with one line that says how many outcomes were finished out of how many planned.

Five blocks: Done, Carried or dropped (with verdicts), Loose ends captured, Next week's outcomes (each with first action and day), and One change to try. Keep it to one screen. Offer to save it with `create_file` as a dated markdown note.
