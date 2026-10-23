---
name: metric-definition
description: Writes an exact, computable definition of a metric with numerator, denominator, time window, filters, grain, ownership and edge cases. Use when the user asks to define a metric such as active users or churn, when teams disagree on a number, or when a metric spec is needed.
---

# Metric definition

## Goal

Make a metric mean one thing everywhere. A good definition can be turned into a query by someone who was not in the room, gives the same number for the same data, lists the cases that people argue about, and names who owns it.

## When to use

- Two reports show different values for the same-named metric.
- A new KPI is being introduced and needs a precise meaning.
- A metric is moving to a new tool or source and must be reproduced.
- For presenting metrics in a dashboard, use `use_skill` with `dashboard-spec`.
- For documenting the fields behind a metric, use `use_skill` with `data-dictionary`.

## Steps

1. Start from the decision. Ask with `ask_user` what the metric is for, who acts on it, and what number would change their action. A metric nobody acts on does not need a rigorous definition.
2. Write the plain-language statement in one sentence: "The share of customers who started in a month and made a second purchase within 60 days."
3. Pin down each part:
   - Entity: customer, user, account, order or session, and which ID identifies it.
   - Event: the exact event or state counted, and its source table or log.
   - Numerator and denominator: written as separate counts, with who is in each.
   - Window: calendar month, rolling 28 days, or time since signup. State the time zone.
   - Filters: internal and test accounts, refunds, cancelled orders, bots.
   - Grain and slice: what it can be broken down by, and what it cannot.
4. Write the edge cases and the ruling for each. Examples: a user who is active in two segments, an order refunded after the period ends, an account merged with another, late-arriving events and who is counted when they arrive.
5. Choose the aggregation rule for rollups. Say whether a total is a ratio of sums or an average of ratios, because they differ when group sizes differ. For distinct counts say that totals across slices do not add up.
6. Write the computation as pseudo-code or a query with `create_file`. If data is available, use `run_code` to compute it on a sample and check it against a number someone already trusts, and note the gap.
7. Check against a known case: pick three entities, calculate by hand from raw rows, and confirm the query counts them as the definition says.
8. Add metadata: owner, source tables, refresh time, version, date of last change, and a changelog line for any later change. Name related metrics and how they differ.
9. Share with the main users and collect objections before it becomes the official number.

## Gotchas

- An implicit denominator is the commonest source of disagreement: percent of whom? Write it out each time.
- A change in definition breaks the trend line. Version the metric and recompute history, or mark the break.
- Active users defined by "any event" counts automated pings. Choose events that show value, not background noise.
- Mean of daily ratios weights a quiet day as much as a busy one. Use the ratio of totals when the question is overall.
- Time zones assign late-evening events to different days. Fix one zone for the metric.

## Output

- The one-sentence statement and the detailed spec table.
- The edge case rulings and the aggregation rule.
- The query or pseudo-code, the check against a trusted number, and the owner and version.
