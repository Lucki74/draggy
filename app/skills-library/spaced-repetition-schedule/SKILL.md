---
name: spaced-repetition-schedule
description: Turns a list of topics, cards or chapters into a dated review calendar with intervals that grow when recall is good and shrink when it is not, plus a rule for missed days. Use when the user asks when to review something, wants a spaced repetition plan, or asks how to space out revision.
---

# Spaced repetition schedule

## Goal

Give the user a review plan they will actually follow: which items to see on which days, how the gaps widen, and what to do when a day is missed. The schedule fits their available minutes, not an ideal learner's.

## When to use

- The user has material to memorise or retain and a date or a long horizon.
- The user already has cards and wants them paced: use `use_skill` with `flashcards` to make the cards first.
- The user wants an overall study timetable by week: use `study-plan`.

## Steps

1. **Collect the facts.** Use `ask_user` for the item list or the file holding it, the start date, an end date if any (exam, trip), and minutes per day available. Read a file with `read_file`.
2. **Count the load.** Number the items and set how many new items fit per day. A review pile grows faster than people expect, so start low.
3. **Choose a rule.** For a fixed deadline, use expanding gaps that end shortly before it (for example 1, 3, 7, 14 days). For long-term retention, use gaps that multiply after each success. Name the rule in plain words.
4. **Add difficulty.** Items the user finds hard restart at a short gap. Easy ones jump a step. Ask the user to rate each review as hard, ok or easy.
5. **Compute the calendar.** Use `run_command` to place each item's reviews by date from the start date. Check the daily load never exceeds the minutes available.
6. **Smooth the peaks.** Where a day is overloaded, move new items to later days. Reviews of old items outrank new material.
7. **Write the missed-day rule.** After a gap, do the oldest due items first, drop new items for a day, and never try to catch up everything at once.
8. **Save the plan.** Use `create_file` for a table: date, items due, new items, expected minutes. Offer a CSV the user can open in a spreadsheet.
9. **Set a check point.** At the end of week one, ask the user for actual time spent and adjust new items per day.
10. **Handle a deadline.** If an exam date exists, count back and stop adding new items two weeks before it, so the last stretch is review only.
11. **Export if asked.** Offer a CSV of date, item and interval for a calendar or spreadsheet import.

## Gotchas

- Intervals are a model of average memory. Real recall varies by item, so rating each review beats a fixed table.
- Learning a lot of new items in the first week creates a review wall in weeks three and four. Plan the whole load across the weeks.
- Cards that are only recognised, not recalled, pass reviews without being known. Prompt for recall before showing the answer.
- A schedule that needs an hour a day fails by day ten. Cut new items until it feels light.
- Do not reset all intervals after one bad day. Only the items missed move.
- For skills such as playing music, spacing applies to practice sessions, not to flipping cards.
- Review apps already compute intervals. If the user has one, plan new-item pace and workload, and let the app do dates.
- Sleep and stress change recall. Treat a bad week as data and widen no gaps until it passes.

## Output

The rule in two lines, the first two weeks as a dated table, the missed-day rule, and the file path if saved. Keep the explanation under 150 words.
