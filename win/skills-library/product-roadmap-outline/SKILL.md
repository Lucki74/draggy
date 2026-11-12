---
name: product-roadmap-outline
description: Turns goals, ideas and constraints into a product roadmap grouped by now, next and later, with an outcome and a reason for each item and no false promises on dates. Use when the user asks for a roadmap, wants to plan the product for the next quarter or year, or asks what to build next.
---

# Product roadmap outline

## Goal

A roadmap people can read and agree on. It shows what the team will work on, why, in what order, and how confident the plan is. Further-out items are looser than near ones, and every item ties to an outcome.

## When to use

- The user needs a roadmap for a product, a team or a stakeholder meeting.
- The user has a pile of ideas and no clear order.
- For scoring individual features, use `use_skill` with `feature-prioritization`.
- For turning one chosen item into tasks, use `use_skill` with `project-plan`.
- For setting measurable goals, use `use_skill` with `okr-drafter`.
- A stakeholder asks "what is coming" and the user needs an answer that does not overpromise.

## Steps

1. Ask with `ask_user` for the product, the horizon (quarter, half-year, year), the team size and the business goals for the period. Read any existing backlog or notes with `read_file`.
2. Write the outcomes the period must produce, three at most. An outcome is a change in customer behavior or business results, such as "more new users finish setup". Features are the means.
3. Gather the candidates: features, fixes, debt, requests. Remove duplicates and group them by the outcome they support. Items that support none go to a parking list.
4. Sort by horizon. Now: committed work for the next four to six weeks, with the highest confidence. Next: planned for the following quarter, scope still open. Later: directions to explore, no commitment.
5. For each item write: the outcome it serves, a one-line scope, the evidence that it matters (customer calls, data the user supplied), and a confidence level of high, medium or low.
6. Check capacity. Compare Now against team size and what is already in progress, including fixes and support. Cut until it fits, and keep slack for surprises.
7. Check dependencies: items that block others, items that need other teams or vendors, items tied to fixed dates (a conference, a rule change). Place them early enough.
8. Add risks and open questions at the item level, such as unproven demand or a technical unknown. Plan a small test for the riskiest.
9. Decide how dates are shown. Use time horizons, not exact dates, for Next and Later. State that dates for Now are targets.
10. Write the review rhythm: when the roadmap is revisited (monthly is common) and what changes trigger a revision.

## Gotchas

- A roadmap of feature names with dates becomes a promise. Use horizons and outcomes.
- Everything labeled Now means no priorities. Count the items against real capacity.
- Stakeholder requests pile up if there is no parking list with a reason. Say no with a visible place.
- Unknown work gets estimated too low. Mark unknowns and plan discovery first.
- Maintenance and debt are work. Leave room for them or they take it by force.
- Different audiences need different views. Make a short customer-facing version without internal detail.
- A solo maker has fewer people but the same trap: a roadmap of every idea. Cap Now at what fits one person's month.

## Output

A three-column Now, Next, Later layout with each item on a line: name, outcome, confidence. Under it: Outcomes for the period, Risks and dependencies, Parking list and Review rhythm. About one page.
