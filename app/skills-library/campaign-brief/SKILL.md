---
name: campaign-brief
description: Writes a one or two page marketing campaign brief with a measurable goal, a narrow audience, a core message, channels, budget, timeline, owners and success measures, so a team can start without more meetings. Use when the user asks for a campaign brief, marketing plan for a launch or a single promotion.
---

# Campaign brief

## Goal

A brief that answers who, what, why, where, when, how much and how we will know. A teammate or agency can read it in five minutes and start work. Every number in it is the user's or is flagged as an assumption.

## When to use

- A product launch, event, seasonal push or promotion is coming and the team needs alignment.
- A campaign is vague ("get more awareness") and needs a measurable target.
- For the market approach behind it, use `use_skill` with `go-to-market-plan`.
- For the audience detail, use `use_skill` with `audience-research`.
- For the posting schedule, use `use_skill` with `content-calendar`.

## Steps

1. Ask with `ask_user` for the campaign trigger, the business goal, the audience, the budget range, dates, past results and constraints (legal, brand, tools). Read prior reports with `read_file`.
2. Write the goal as one measurable result with a number and a date, tied to a business outcome: sign-ups, sales, bookings or qualified leads. Reach and clicks are means, not goals, unless the user says otherwise. If no baseline exists, state it as unknown and put "measure the baseline first" on the plan.
3. Define the audience narrowly: one primary group with a situation, a need and what they do today. Add a secondary group only if it matters.
4. Write the core message in a sentence, the single thing the audience should remember, plus three proof points the user can support. Do not invent claims.
5. Choose the channels by where the audience already is and what the budget can cover. For each channel give its job (attract, convince, convert), the format and the call to action.
6. Look at what rivals or similar launches did, with `search_web`, for the creative and channels. Note it as context, not as target figures.
7. Set the timeline: prep, launch, run, review. Mark dependencies such as approvals, assets and landing pages.
8. Allocate budget and effort by channel and stage, and keep a reserve of about a tenth for fixes. Give the owner of each deliverable.
9. Define the measures: one primary metric tied to the goal, two or three supporting ones, how and when they are read, and the decision rule for stopping or shifting spend.
10. List risks and open questions, and the approvals needed before launch.

## Gotchas

- A goal like "increase brand awareness" cannot be judged. Give it a number or accept that it will not be judged.
- An audience of "everyone aged 18 to 65" yields a message for no one. Pick the most valuable group.
- Without a named owner for results, nobody changes anything when numbers disappoint.
- Copying another company's conversion rates as targets misleads. Use own baselines.
- Landing pages, tracking and approvals take longer than creative. Schedule them first.
- Track from the start. Use `utm-tracking-plan` so results can be traced to channels.
- A brief longer than two pages is rarely read. Move detail to an appendix and keep the core short.

## Output

A brief with sections: goal, audience, message and proof, channels and roles, timeline, budget and owners, measures and decision rules, risks. Open questions at the end.
