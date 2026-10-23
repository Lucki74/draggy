---
name: e2e-test-plan
description: Chooses the few user flows worth an end-to-end test and writes each as steps with expected results, data needs and stable selectors, ready to automate or run by hand. Use when the user asks what e2e tests should cover, wants an end-to-end test plan, or a test plan for an app.
---

# End-to-end test plan

## Goal

Produce a short plan of the user journeys that must never break, each specific enough to automate or to follow by hand. A good result is five to fifteen flows ranked by importance, not a list of every screen.

## When to use

- A project has no e2e tests and the user does not know where to begin.
- An existing suite is slow or brittle and needs pruning.
- Before a release, a manual smoke checklist is wanted.
- A launch date is near and the team wants a final checklist.
- An existing end-to-end suite takes too long and needs pruning.
- QA needs written scripts for manual testing.

To run flows now against a local app, use `use_skill` with `webapp-testing`.

## Steps

1. **Understand the product.** Read the README, routes and main screens with `read_file`, `list_directory` and `search_files`. Ask with `ask_user` what the app earns or loses money on, and what support gets complaints about.
2. **List candidate journeys.** Sign up and sign in, the core task, payment or save, search, settings that change data, error recovery. Write each as one sentence from the user's point of view.
3. **Rank them.** Score impact if broken, usage, and how many parts the flow crosses. Keep the top group for e2e. Push the rest down to unit or integration tests.
4. **Write each flow.** Fields: name, preconditions and data, numbered steps, expected result after each key step, and cleanup. One flow, one outcome.
5. **Plan selectors.** Prefer roles, labels and visible text, or a dedicated test id attribute. Avoid CSS classes and positions. Note missing hooks the code needs; propose `edit_file` changes separately.
6. **Plan data and environment.** Name the test accounts, seed method, what is reset between runs, which third parties are faked, and which browsers and viewports matter.
7. **Add negative paths** for the top flows: invalid input, expired session, offline, server error.
8. **Write the plan** to a file with `create_file` if the user wants it saved, and suggest a runner only after checking the project and its current docs with `read_url`.
9. Review the plan against the list of past incidents and add a flow for any that had no cover.

## Gotchas

- Trying to cover every path gives a slow, flaky suite nobody trusts. Cover the critical few.
- Flows that depend on data left by earlier flows fail when run alone or in parallel.
- Selectors tied to styling break on every redesign.
- Real email, payment and SMS in tests cause side effects and flakiness. Use sandbox modes or fakes.
- A plan with vague expectations ("works fine") cannot fail. Each step needs a visible check.

## Output

A ranked table of flows, then the detailed flow cards, then a list of needed test hooks and data. Keep the whole plan on a few pages.

Mark which flows are good candidates to automate first.
