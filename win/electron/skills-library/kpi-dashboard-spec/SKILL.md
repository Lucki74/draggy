---
name: kpi-dashboard-spec
description: Chooses a small set of KPIs for the user's goals and writes each with a definition, formula, data source, owner and refresh rate. Use when the user asks which KPIs to track, wants a metrics spec for a business dashboard, or needs agreed definitions for their numbers.
---

# KPI dashboard spec

## Goal

Produce a one-page specification that a person or a tool can build from: a short list of measures, each defined so two people compute the same number. The skill specifies; it does not build the dashboard.

## When to use

- The user is starting to track business performance and does not know what to track.
- Team members quote different numbers for the same metric.
- A software dashboard design is `use_skill` with `dashboard-spec`.

## Steps

1. Ask with `ask_user` for the business type, the two or three goals for the next quarter, who will read the dashboard, and the tools that hold the data.
2. Propose five to eight KPIs, each tied to one goal. Prefer a mix: a few leading measures the team can influence and a few lagging results.
3. For each KPI write: name, one-line meaning, exact formula with numerator and denominator, unit, time window, and data source.
4. Name an owner for each KPI, the person who can explain a change.
5. Set the refresh rate and the reading rhythm (weekly, monthly). Do not suggest real-time unless a decision needs it.
6. Define how to read each: what direction is better, and what range would make the owner investigate. Ask the user for thresholds, or leave them blank.
7. Mark KPIs that cannot be computed yet because data is missing, and say what to start collecting.
8. Cut the list. Remove any KPI that would not change an action.
9. Offer the spec as a table saved with `create_file`, plus a sketch of layout: headline numbers on top, trends below.
10. Run a test with the user: for each KPI, ask what they would do if it fell by a fifth.
11. Check each data source can actually deliver the field, and note who can export it.

## Gotchas

- Vanity counts such as total sign-ups with no activity measure.
- Ratios with no stated denominator, so two people get different answers.
- Mixing time windows, for example a monthly revenue next to a weekly cost.
- Targets copied from other businesses. Targets must come from the user's own history or goals.
- No owner, so nobody acts on a red number.
- Too many tiles. More than eight and the dashboard stops being read.
- Defining a KPI by a tool's label rather than the business meaning.
- Measures that can be gamed with no counter-measure alongside them.

## Output

A table with one row per KPI and the fields above, then a short list of data gaps and the proposed layout. No invented benchmark figures.

Add a short review ritual: who looks at it, how often, and what they decide.
