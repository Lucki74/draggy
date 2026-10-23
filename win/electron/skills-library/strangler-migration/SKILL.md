---
name: strangler-migration
description: Plans and carries out a gradual replacement of an old component by putting a seam in front of it, routing slices of use to the new implementation, comparing results, and retiring the old one on a set date. Use when the user wants to migrate off legacy code without a big-bang rewrite, or asks about the strangler pattern.
---

# Strangler migration

## Goal

Replace an old component one slice at a time while the product keeps running. At every point both paths work, the switch is reversible, and the old code has a defined end date and a removal step.

## When to use

- A legacy module, service or library must be replaced and a rewrite-and-swap is too risky.
- The old component has many callers and cannot be changed in one go.
- To split a big system into parts, use `use_skill` with `monolith-split`.
- For data schema changes alone, use `use_skill` with `database-migration`.
- Callers are spread across teams, so a coordinated swap is unrealistic.

## Steps

1. Map the old component with `explore` and `search_files`: entry points, callers, data it owns, side effects, and what it promises in behaviour. Write the contract in plain words.
2. Choose the seam: a single place all callers pass through, such as a facade function, an interface, a route prefix or a proxy. If no seam exists, creating one is the first change and ships alone, forwarding everything to the old code.
3. Slice the work by something measurable: one route, one customer segment, one feature, one record type. Order slices from low risk and high learning to high risk. Write the order with `update_plan`.
4. Build the new implementation for the first slice behind the seam. Route by a switch the team controls (flag, config value, percentage), default to the old path.
5. Prove equivalence before cutting over. Run old and new on the same inputs and compare outputs, using tests, recorded requests or shadow calls whose new result is logged and discarded. Use `run_command` or `run_code` for the comparison script. Decide in writing what differences are acceptable.
6. Cut over the slice, watch the agreed signals (errors, latency, mismatches), and keep the switch back to the old path available until the slice has run cleanly for the agreed time.
7. Repeat for each slice. After each, delete anything that is now unused on the old side, so the old component visibly shrinks.
8. Set an end date with the user via `ask_user`. When the last slice is done, remove the seam's old branch, the switches, and the old code, and run the full suite.
9. Keep a short log of mismatches found during comparison and what each one taught about the old behaviour. It becomes the spec of the new component.

## Gotchas

- Without an end date the old and new paths coexist for years and double the maintenance. Put the removal task in the plan from the start.
- New code that calls helper functions of the old component quietly ties the two together. Pull shared helpers into a neutral place first.
- Data is the hard part. If both paths write, decide which one is the source of truth per slice, and how the other stays consistent.
- Shadow calls with side effects (emails, charges) must not run twice. Mark them read-only or stub the effects.
- Matching old behaviour includes matching its bugs that callers depend on. List them and decide per bug whether to preserve or fix with notice.
- A percentage rollout with no per-request stickiness gives a user different behaviour on each request. Route by a stable key.
- Measure the old path's cost while the migration runs. If the migration stalls, you pay for both and need to know it.
- Do not let the seam grow its own business logic. It routes and nothing else.

## Output

- The contract summary, the seam, the slice order and the switch mechanism.
- Per slice: status, equivalence evidence, rollback switch, removal task.
- The end date and the list of things to delete when done.
- Switch settings per environment and who may change them.
- Risks and the signal that would make you pause the migration.
