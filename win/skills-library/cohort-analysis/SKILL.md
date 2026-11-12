---
name: cohort-analysis
description: Groups users or customers by the period they started, builds a retention or revenue cohort table, and reads it correctly across cohorts and ages. Use when the user asks for a cohort table, how retention changes by signup month, or whether newer users stay longer.
---

# Cohort analysis

## Goal

Show how groups that started at different times behave as they age, so that real changes in quality can be told apart from the mix of old and new users. A good result has a clear cohort definition, an activity definition, a table by cohort and age, and a reading that respects incomplete periods.

## When to use

- Retention, repeat purchase or revenue per customer by start month.
- Checking whether a product change improved later behaviour.
- Overall numbers look stable but the user suspects old and new users differ.
- For measuring step-by-step drop-off in a flow, use `use_skill` with `funnel-analysis`.
- For writing the metric precisely first, use `use_skill` with `metric-definition`.

## Steps

1. Define three things with the user, in writing. Use `ask_user`. The cohort rule (first purchase month, signup week), the activity event that counts as retained (any login, a purchase), and the period size (day, week, month).
2. Load the event data with `run_command`. Needed columns: a user ID, an event timestamp, and the start date or the event that defines it. Check that each user has exactly one start, and that timestamps share one time zone.
3. Assign each user to a cohort by the period of their start. Compute each event's age as the number of periods since the cohort start, not the calendar period.
4. Build the matrix: rows are cohorts, columns are ages (0, 1, 2, ...). Cell value is the number of users active at that age, divided by the cohort size for a retention rate. For revenue, sum revenue per cohort and age, then divide by cohort size.
5. Mask cells that are not complete yet. The most recent cohort has not reached later ages, and the current period is partial. Leave those cells blank, never zero.
6. Add the cohort size column and a weighted average row. Small cohorts get a note, since their rates are noisy.
7. Read it along three directions:
   - Down a column: is the same age getting better or worse for newer cohorts?
   - Along a row: does the curve flatten (a stable core) or keep falling?
   - Across the diagonal: did something on a calendar date affect all cohorts, such as an outage or a price change?
8. Plot the retention curves of a few cohorts, or a heat map with a sequential colour and the numbers inside. Save with `create_file`.
9. State the finding with the cohort sizes and the ages compared, and list the caveats.

```python
df["cohort"] = df.groupby("user")["ts"].transform("min").dt.to_period("M")
df["age"] = (df["ts"].dt.to_period("M") - df["cohort"]).apply(lambda x: x.n)
table = df.groupby(["cohort", "age"])["user"].nunique().unstack()
```

## Gotchas

- Reading the newest cohort's partial ages as a drop makes every report claim retention is getting worse. Mask incomplete cells.
- A calendar-month view (columns are months of the year) mixes ages and hides the lifecycle. Use age as the axis.
- Cohorts defined by a later event than signup (first purchase) drop everyone who never bought. State who is in or out.
- Changes in what counts as active, or in tracking, shift every cohort at once on the same date. Check the diagonal first.
- Survivors differ from the average user. A flat curve at 20 percent says who stayed, not that the product is sticky for everyone.

## Output

- The cohort, activity and period definitions.
- The retention table or heat map with sizes, and the weighted average.
- Two or three findings with ages and cohorts named, and the caveats.
