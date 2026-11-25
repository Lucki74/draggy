---
name: daily-plan
description: Turns a messy task list and the hours actually available into a realistic plan for one day, with a short must-do list, a time order and a buffer. Use when the user asks to plan their day, says they have too much to do, or asks what to do first today.
---

# Daily plan

## Goal

A plan for today that fits the hours the user really has. It names the one to three things that must happen, puts them in an order that suits the user's energy, and leaves room for what will interrupt.

## When to use

- The user asks to plan the day or says the list is overwhelming.
- The user asks what to start with.
- For a whole week, use `use_skill` with `weekly-review`.
- For placing tasks into calendar slots, use `use_skill` with `time-blocking`.
- For a single deep work session, use `use_skill` with `focus-session-plan`.
- The user starts the day with no plan and 40 unread messages and wants a way in.

## Steps

1. Ask with `ask_user` for three things in one message: the task list, today's fixed commitments with times, and the hours the user can work. If they gave these already, skip the question.
2. Compute the real budget. Take the working window, subtract fixed commitments, meals and travel, then subtract about a quarter for interruptions. State the number of free hours out loud.
3. Sort the tasks. Mark each as due today, has a consequence if skipped, or can wait. Anything in the last group leaves the plan.
4. Estimate each remaining task in minutes. If the user is unsure, use a rough size (15, 30, 60, 90) and say it is a guess.
5. Pick the must-do list: one to three tasks that, if done, make the day a success. Check that their total fits the budget. If not, cut or split until it does.
6. Order the day. Put the hardest must-do in the user's best energy window, shallow admin after meetings or lunch, and calls where they are fixed. Ask about energy only if it is unknown.
7. Add a buffer block of 30 to 45 minutes and a stop time.
8. List the tasks that were dropped for today, each with a suggested day, so they are not forgotten.
9. Verify against the Goal: the total of planned minutes is below the budget, and each must-do appears in the order.

## Gotchas

- A plan that fills every free hour fails at the first interruption. Keep the buffer even when the list is long.
- Small tasks feel productive and eat the day. Schedule the must-do first, then batch small items.
- Estimates run short for work the user has not done before. Add half again for new kinds of task.
- Do not plan tomorrow's work into today to feel ahead.
- A task like "deal with taxes" is a project. Replace it with its first action before it goes on the list.
- Check time zones if a call is with someone elsewhere. A wrong hour breaks the order.
- If the day is already half gone, plan only the hours left and say the earlier hours are sunk.

## Output

Lead with the number of free hours and the number of planned hours so the user sees the margin at once.

A short list: Must-do (one to three), Schedule with times, Buffer, and Not today with a suggested date. Under 15 lines for the plan itself. If the user wants it in a file, use `create_file` for a markdown note.
