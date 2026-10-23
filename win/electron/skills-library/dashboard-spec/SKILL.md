---
name: dashboard-spec
description: Writes a dashboard specification covering audience, decisions, metrics, filters, layout and refresh rules before any tool is opened. Use when the user asks to spec out a dashboard, what belongs on a KPI dashboard, or for requirements for a reporting page.
---

# Dashboard spec

## Goal

Agree what the dashboard is for before anyone builds it, so that the build is quick and the result is used. A good spec links each element to a decision, defines every metric, limits the filters, names the data sources and the owner, and says when the dashboard should be retired.

## When to use

- A team asks for "a dashboard" and has not said what it should answer.
- An existing dashboard has too many tiles and nobody trusts it.
- A build is about to start in a BI tool, a web app or a workbook.
- For the workbook build itself, use `use_skill` with `dashboard-sheet`.
- For defining each metric rigorously, use `use_skill` with `metric-definition`.

## Steps

1. Identify the audience and the moment of use with `ask_user`: who opens it, how often, on what device, and what they do next. A weekly leadership check differs from a live operations screen.
2. List the decisions it supports as questions: "Do we need to add staff this week?" Drop any requested number that supports no decision, or move it to an appendix view.
3. Derive the metrics from the questions. For each give a name, a one-line definition, the comparison shown (target, prior period, same period last year) and the threshold that means "act". Link a full definition where one exists.
4. Check the data. For each metric note the source table or system, the refresh lag, the owner of the source and any known quality issues. If a metric cannot be computed today, mark it as blocked and say what is needed. Use `read_file` or `run_code` on a sample to confirm the fields exist.
5. Choose the filters. Keep to the few that real users need (period, region, product). Set a default for each, and say how they combine. Each extra filter multiplies the cases to test.
6. Sketch the layout in text: a top row of headline numbers, a trend area, a breakdown area and a detail table below. Order by importance, with the most urgent signal at top left. Use `use_skill` with `chart-picker` to choose the chart for each question.
7. Set the states: what shows when data is late, when a filter returns nothing, when a metric is undefined for a period. Specify the data freshness label.
8. Write access and ownership: who can see which rows, who maintains the definitions, who is told when the numbers break, and the review date for removing unused tiles.
9. Define acceptance checks: three numbers that must match a trusted report, a load time target and a test with a late data case. Save the spec with `create_file` and use `update_plan` for the build steps if the user will go ahead.

## Gotchas

- Starting from available data instead of decisions produces a wall of charts that answers nothing. Questions come first.
- Twenty tiles dilute attention. A rule of thumb is five to eight numbers per screen and one story per page.
- Targets with no source or owner turn into arguments. Name who sets them and when they are revised.
- Row-level security is easy to forget until a regional manager sees national salaries. Decide access at spec time.
- Dashboards with no review date accumulate for years. Put a sunset or review date in the spec.
- A tile that needs a manual refresh will go stale. Say who refreshes it or automate it before launch.
- Mixed time zones across sources shift daily counts. State the reporting time zone.
- Colour alone should not carry status. Pair it with a label or icon for readers with colour blindness.

## Output

- Audience, decisions and the metric table with definitions, sources and thresholds.
- Filters, layout sketch, states and access rules.
- Blocked items, acceptance checks and the review date.
- The open questions for the owner, each with a name and a date.
- The list of metrics dropped from the first release, with the reason for each.
- The path where the spec is saved.
