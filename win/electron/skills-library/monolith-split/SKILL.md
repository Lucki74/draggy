---
name: monolith-split
description: Finds the natural boundaries in a large codebase from dependencies, data ownership and change patterns, then orders a split into modules or services so the product keeps shipping. Use when the user wants to split a monolith, asks where the module boundaries are, or wants one part pulled out into its own service.
---

# Monolith split

## Goal

Decide which parts can separate cleanly, in what order, and what has to change first. The result is a map of boundaries, a first extraction that is small and reversible, and a clear statement of what the split costs.

## When to use

- One codebase is slowing teams down and parts evolve at different speeds.
- A single area needs its own scaling, release cycle or ownership.
- For replacing one component gradually behind a seam, use `use_skill` with `strangler-migration`.
- For writing down the decision itself, use `use_skill` with `adr-writer`.
- An outage in one area keeps taking down unrelated areas.

## Steps

1. State the reason for splitting in a sentence. Valid reasons are independent deploys, different scaling, team ownership or isolating risk. If the reason is "microservices are modern", stop and discuss modules inside the same deployable first.
2. Map the code with `explore`, `list_directory` and `search_files`: top-level areas, their imports of each other, shared utilities, and global state. Build a dependency table of who calls whom and how many times.
3. Map the data. List tables, collections and files per area and who writes each. A boundary that shares writable tables is not a boundary yet.
4. Add change history with `run_command` and `git log --name-only`: areas that change together belong together, and areas that rarely co-change are candidates to separate.
5. Score candidates: few inbound dependencies, clear owned data, an interface that can be written as a short list of calls, and a pain that the split solves. Pick the best first candidate.
6. Prepare inside the monolith before any network exists. Introduce an explicit interface for the candidate, move callers to use it, move its data access behind it, and enforce the boundary with import rules or a lint check. Ship this stage alone.
7. Only then decide the form: a separate module in the repo, a separate package or a service. Each in-process call that becomes a remote call needs timeouts, retries, error handling, versioned contracts and observability.
8. Write the sequence with `update_plan`: each step shippable, with an exit check, and the first extraction small. Ask the user with `ask_user` to confirm the reason and the candidate.
9. Estimate the operating cost of the result in plain terms: extra deploys, dashboards, on-call load and local setup. Put it beside the benefit.

## Gotchas

- Splitting along the folder layout produces pieces that still call each other all day. Boundaries follow data ownership and change patterns.
- A shared database keeps the pieces coupled, since any schema change breaks all of them. Plan data separation explicitly, with a period of dual access if needed.
- Calls that were function calls and become network calls gain failure modes, latency and partial failure. A chatty interface becomes a performance problem.
- Shared libraries become the next monolith. Keep them small and versioned, or duplicate the tiny bits.
- Transactions across the old boundary vanish. Identify them and choose sagas, outbox patterns or a merged boundary.
- Operational cost grows with each service: deploys, monitoring, on-call, local development. Count it in the plan.
- A team boundary matters as much as a code boundary. If one team will own both halves, the split may add cost with no gain.
- Do not extract the most painful part first. Start with a well-bounded one to learn the process cheaply.

## Output

- A boundary map: candidates, dependencies in and out, owned data, score.
- The first extraction, its preparation steps in order, and its exit checks.
- Costs and risks, with the ones that need a decision marked.
- What stays in the monolith and why.
- Decision log entries to record, ready for an ADR.
