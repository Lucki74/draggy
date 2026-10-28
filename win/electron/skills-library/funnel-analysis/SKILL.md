---
name: funnel-analysis
description: Defines ordered steps, computes conversion and drop-off between them per user, and finds where and for whom the funnel leaks. Use when the user asks where users drop off, to build a conversion funnel, or to compare a funnel across channels or devices.
---

# Funnel analysis

## Goal

Show how many people move from each step to the next and where the biggest losses are, with definitions precise enough that two analysts get the same numbers. A good funnel counts users once, respects order and time windows, and points to a segment or step worth investigating.

## When to use

- Checkout, signup, onboarding or any multi-step flow with a goal at the end.
- A conversion rate dropped and the user wants to know which step changed.
- Comparing funnels by source, device, country or version.
- For behaviour over weeks after signup, use `use_skill` with `cohort-analysis`.
- For deciding whether a change worked, use `use_skill` with `ab-test-reading`.

## Steps

1. List the steps with the user, in order, and map each to an event or a page. Ask with `ask_user` whether the order is strict, whether steps can be skipped, and which window applies (within one session, within seven days). Write the definitions down.
2. Choose the unit: users, sessions or orders. Funnels by user answer "who converted", funnels by session answer "which visits converted". Do not mix units across steps.
3. Load the events with `run_command`. Check the event names exist, are not duplicated by retries, and have a user or session ID. Count each step's raw event total as a sanity check.
4. For each user, find the first time they hit step one. Then find the first time they reach step two after it, within the window, and so on. Users enter later steps only if they passed earlier ones in order.
5. Compute for each step: users reaching it, conversion from the previous step, conversion from the start, and median time since the previous step.
6. Find the largest absolute loss and the largest relative loss. They may be different steps: a 2 percent drop on a huge step can lose more people than a 40 percent drop on a small one.
7. Segment the funnel by the dimensions that plausibly matter (channel, device, new versus returning, version). Show the steps where segments differ most. Keep to a few cuts and mark small groups.
8. Check for tracking issues: a step with higher count than its predecessor, a sudden zero on a date, an app version that does not send the event. These explain many "drops".
9. Visualise as a horizontal funnel or a table with counts and percentages, and save with `create_file`. State the finding and a next investigation, such as session recordings or an experiment.

## Gotchas

- Counting events rather than users inflates early steps with retries and double clicks, and the funnel looks worse than it is.
- Without a time window, a user who comes back six months later is counted as a conversion of the old visit. Pick a window and state it.
- Steps that can happen in any order (add address, add payment) are not a strict funnel. Use a "completed all" definition for them.
- Losing users because of a tracking gap looks identical to losing them in the product. Compare with a server-side count.
- Conversion by segment can reverse in total (mix effect). Check the segment sizes before declaring a segment the cause.
- Comparing a funnel across periods with different step definitions gives false trends. Freeze the definitions first.
- Users who skip a step, for example through a deep link, break strict ordering. Decide whether to count them and say so.
- Bots and internal traffic inflate top-of-funnel counts. Filter them before computing rates.

## Output

- The step definitions, unit and window.
- A table of users, step conversion, cumulative conversion and median time per step.
- The top two leaks with segment evidence, tracking caveats and the suggested next check.
- The date range and the cohort rule, so the funnel can be rerun and compared next period.
- A short list of events to verify with the tracking owner before the numbers are quoted.
- The chart file path for the step-by-step drop view, if one was made.
