---
name: go-to-market-plan
description: Drafts a go-to-market plan for a product or feature covering the first audience, the message, a few channels, launch steps, owners and the measures that show if it works. Use when the user asks how to launch a product, wants to find first customers, or needs a launch plan.
---

# Go-to-market plan

## Goal

A plan to reach the first real buyers with a narrow audience, a clear message and two or three channels the team can run well. It lists dated steps and says how success will be judged.

## When to use

- The user is about to launch a product, a feature or a new offer.
- The user has a product but few customers and needs a route to them.
- For entering a new region or segment, use `use_skill` with `market-entry-outline`.
- For the message itself, use `use_skill` with `positioning-statement`.
- For a brief on one campaign inside the launch, use `use_skill` with `one-pager`.
- The user already launched quietly and wants a plan for the second push.

## Steps

1. Ask with `ask_user` for the product, price or pricing idea, the stage (idea, beta, live), the team size, the budget and the launch date or window.
2. Choose the first audience. One segment with a shared problem and a place where they gather. Ask which customers have already shown interest and why. Use `use_skill` with `customer-persona` when the audience is unclear.
3. Write the message in one sentence: for whom, which problem, what outcome, why this over alternatives. If it will not fit one sentence, simplify before moving on.
4. Choose the offer and entry path: free trial, demo, pilot, paid start. Match it to how the buyer decides: self-serve for low-cost products, a conversation for high-stakes ones.
5. Choose two or three channels. For each: why the audience is there, the cost in time or money, and the first test. Examples are direct outreach, communities, content, partners, paid ads and events. Do not cite channel performance numbers unless sourced via `search_web`.
6. Build the launch sequence in phases: prepare (assets, landing page, tracking), soft launch to a small group, public launch, and follow-up. Give each step an owner and a date.
7. Set the measures. Pick one primary number (qualified conversations, sign-ups, first purchases) and two supporting ones. Set targets only from the user's baselines. If none exist, set the target as "measure the first week".
8. Plan feedback: where responses are collected, how quickly they are read, and what triggers a change.
9. List risks (message misses, channel fails, support overload) and a fallback for each.
10. Review: the plan fits the team size and the budget, and every channel has an owner.

## Gotchas

- Targeting everyone spreads the budget so thin that nothing is learned. Pick one audience.
- Too many channels at once make it impossible to tell which one worked.
- Launch day is the start. The plan must cover the four weeks after it.
- Without tracking in place before launch, the first results are lost. Set up links and sources first with a named source for every link.
- Targets invented from other companies' results mislead. Use the user's own baseline.
- Support load after launch is often forgotten. Plan who answers.
- Platform rules for ads and listings change. Check the current policy page with `read_url` before planning a paid channel.

## Output

Sections: Audience, Message, Offer, Channels (table), Timeline (table with owner and date), Measures, Feedback loop, Risks. Two pages at most. Offer `create_file` to save it.
