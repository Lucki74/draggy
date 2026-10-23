---
name: build-vs-buy-decision
description: Compares building in-house, buying a product or service, or partnering on cost over time, control, speed, fit and risk, with live checks on vendor facts, and recommends one route with the conditions that would change it. Use when the user asks whether to build or buy, use a vendor or do it in-house, or compare make versus buy.
---

# Build vs buy decision

## Goal

A reasoned recommendation among build, buy and partner that counts the full cost over a chosen period, beyond the first invoice. The user sees what each route assumes and what would flip the answer.

## When to use

- The user must choose between developing a capability and using a vendor's product or service.
- The user is reviewing a vendor renewal or an internal tool that is costly to keep.
- For comparing vendors once buying is chosen, use `use_skill` with `product-comparison-research`.
- For a general option comparison, use `use_skill` with `compare-options`.
- For the written case, use `use_skill` with `strategy-memo`.
- A home-grown tool has grown costly and the user wants to know if replacing it makes sense.

## Steps

1. Ask with `ask_user` what capability is needed, why it matters to the business, who will use it, the time horizon (three years is common) and the constraints (budget, deadline, team size, data rules).
2. Decide if it is core. Ask whether the capability sets the business apart. If it does not, buying or partnering is the default, and building needs a reason.
3. Write requirements in two groups: must-have and nice-to-have. Keep to what users need, not features of any vendor.
4. Identify the options: build, one to three real vendors, and a partner or open-source route if it applies. Research vendors with `search_web` and `read_url`: pricing page, limits, security and data terms, support, exit options, and recent news. Note source and date, since prices and terms change.
5. Estimate build cost over the horizon: people (time to build, then to maintain), infrastructure, tools, security work, support and the cost of delay. Use the user's own rates and ask the team that would build it. Mark estimates as ranges.
6. Estimate buy cost over the same horizon: licence or usage fees at expected volume and at double the volume, setup, integration work, training, admin time, add-ons and renewal terms.
7. Compare beyond money: time to first value, fit with requirements, control over roadmap, data location and portability, vendor risk (stability, support, lock-in), skills the team gains or needs, and how hard it is to switch later.
8. Check switching costs both ways. For buy: how data is exported and what leaving costs. For build: what happens if the key person leaves.
9. Run a what-if. Test two inputs, such as volume and build time, at pessimistic values. See whether the ranking changes. Name the break-even point where the answer flips.
10. Recommend a route with the reasons, a first step (a trial, a small spike), a check date, and the trigger that would reopen the decision.

## Gotchas

- Comparing the build's first-year cost with the vendor's yearly fee ignores years of upkeep. Compare over the same horizon.
- Build estimates run short, especially for integration and edge cases. Add a margin and name it.
- Vendor demos show the best case. Test with the user's own data in a trial.
- Lock-in is a cost even when the fee is low. Check export formats and contract terms.
- A deal discount is not a long-term price. Look for renewal terms and usage tiers.
- For contract or data-protection terms, have a qualified adviser review before signing.
- Hidden labor is the main miss on the buy side: configuration, permissions and data cleanup take real hours.

## Output

A table with options as columns and rows for Cost over horizon (range), Time to value, Fit, Control, Risk, and Switching cost; a what-if note; and the recommendation with trigger and check date. Sources listed with dates.
