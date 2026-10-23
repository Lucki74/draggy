---
name: blue-green-deploy
description: Plans a blue green or canary release: two live versions, controlled traffic shift, compatibility of the database and queues across versions, verification gates and an instant switch back. Use when the user asks for zero downtime deploys, blue green setup, or a canary rollout.
---

# Blue green deploy

## Goal

Release a new version beside the old one, move traffic in steps, and keep the old version warm until the new one proves itself.

A good plan also handles the shared database, which both versions use at once.

## When to use

- Downtime during deploys is not acceptable.
- The user wants to test a release on a slice of users first.
- A rolling update has caused mixed version errors.
- For the undo steps in detail, use `use_skill` with `rollback-runbook`.

## Steps

1. Find the current deploy method and platform with `search_files` and `read_file` on workflows, manifests and load balancer config. Ask with `ask_user` if the traffic router is not obvious.
2. Choose the strategy: blue green (switch all traffic at once), canary (percentage steps) or both. Base it on the routing features available. Check the platform docs with `read_url` for the exact feature.
3. List shared state: database, caches, file storage, queues, sessions. Both versions will touch them at the same time.
4. Apply expand and contract to the schema: add new columns first, deploy code that works with both shapes, backfill, then remove the old shape in a later release.
5. Check message formats and API contracts are compatible both ways, and that sessions or cookies survive a switch.
6. Define the stages, for example one percent, ten, half, all. Give each a hold time and the gates: error rate, latency and one business metric compared with the old version.
7. Make the gates automatic where the platform allows, or write the manual check commands.
8. Plan warm up: run health checks and a smoke test against the new environment before it gets any user traffic.
9. Keep the old environment running for a defined period after the full switch, then scale it down.
10. Handle background workers and scheduled jobs: only one version should run them, or they must be safe to run twice.
11. Write the plan or pipeline change with `create_file` or `edit_file`, and rehearse the switch back in staging.
12. Record the cost of running two environments and agree the window.

## Gotchas

- The database is the part that makes blue green hard. Switching traffic back after an incompatible migration breaks the old version.
- Workers on both versions consuming the same queue can process one job with two different code paths.
- Sticky sessions pin users to the old version, so a canary percentage is not what users really see.
- DNS based switching is slow because of caching. Use a load balancer or router weight for fast changes.
- A canary with too few requests shows no errors by luck. Pick a stage size that yields enough traffic.
- Long running connections such as websockets stay on the old side until closed.

## Output

- The strategy, stages with hold times and gates, in a table.
- The schema and contract compatibility plan.
- Switch and switch back steps, and files changed.
