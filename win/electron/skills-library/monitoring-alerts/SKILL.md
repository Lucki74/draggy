---
name: monitoring-alerts
description: Designs monitoring for a service: the few signals that show user pain, alert rules with thresholds and durations, severity routing, and a runbook link per alert, and prunes noisy alerts. Use when the user asks what to monitor, wants alerting set up, or complains that alerts are noisy or missed an outage.
---

# Monitoring and alerts

## Goal

Make sure a human is woken only when users are hurt or about to be, and has what they need to act.

A good alert set is small, each alert has an owner and a first step, and silence means healthy.

## When to use

- A new service needs monitoring before launch.
- The on call gets pages nobody acts on.
- An outage was found by users before the alerts.
- For health endpoints that monitors call, use `use_skill` with `health-checks`.

## Steps

1. Find what exists. Use `search_files` for alert rule files, `prometheus`, `datadog`, `grafana` and `alertmanager`, and read them with `read_file`.
2. Ask with `ask_user` what the user journeys are and what the service promises: availability, latency, freshness. Do not invent targets.
3. Pick signals per service: request rate, error rate, latency percentiles, saturation (CPU, memory, disk, connections, queue depth). Add job freshness for batch work.
4. Write symptom alerts first (error ratio, slow requests, failed checkouts). Add cause alerts (disk filling) only when they give lead time.
5. Set each threshold from observed data. Use `run_command` to query metrics or logs for a typical week, then choose a value above normal peaks.
6. Add a duration (`for:` or evaluation window) so a single spike does not page. Use rate based or burn rate rules over raw counts.
7. Add alerts for the monitor itself: a missing data alert and a heartbeat from a dead man's switch.
8. Assign a severity: page now, ticket next day, dashboard only. Route by severity and by owner.
9. Attach to each alert a summary, the dashboard link and the runbook link or first three checks.
10. Review existing alerts: list those that fired often with no action and propose delete, raise threshold, or turn to ticket.
11. Write rule files with `create_file` in the format the user's tool uses. Check syntax docs with `read_url` when unsure.
12. Test with a deliberate failure in staging or by replaying data, and confirm the page reaches a person.

## Gotchas

- Alerting on CPU above a number pages for healthy busy servers and misses a broken app with idle CPU.
- Averages hide the slow tail. Use percentiles for latency, and know the metric is per instance or aggregated.
- If a service has zero traffic, an error ratio is undefined and the alert may never fire or always fire. Handle empty data.
- Alerts without a runbook mean the person at 3 am starts from zero.
- A monitor that lives on the same host or network as the service goes down with it.
- Copied thresholds from a blog post do not match this service. Measure first.

## Output

- A table of alerts: signal, condition, duration, severity, owner, runbook.
- Alerts to remove or downgrade with reasons.
- Rule files created, and the failure test result or that it was not run.
