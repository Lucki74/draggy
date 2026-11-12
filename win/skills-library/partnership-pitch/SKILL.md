---
name: partnership-pitch
description: Drafts a pitch to another company or person proposing a partnership, with what is in it for them, a small first step, rough roles and the questions to settle, after researching the other side. Use when the user wants to propose a collaboration, approach a company to work together, or write a partnership proposal.
---

# Partnership pitch

## Goal

A short proposal the other side can say yes to in a first conversation. It starts from their interests, shows a plausible fit, asks for one small thing and leaves the details to talks.

## When to use

- The user wants to approach a company, creator or organization about a joint effort: co-marketing, integration, reselling, referral, event or content.
- The user needs a one-page proposal to send before a meeting.
- For a cold first message only, use `use_skill` with `cold-outreach`.
- For a strategic memo inside the user's company, use `use_skill` with `strategy-memo`.
- For a structured stakeholder plan on the other side, use `use_skill` with `stakeholder-map`.
- The user wants to answer an inbound partnership request and needs to judge it.

## Steps

1. Ask with `ask_user` for the user's business, the partner, the kind of deal wanted, what the user can offer and what they need, and any past contact. Ask who the right person at the partner is.
2. Research the partner with `search_web` and `read_url`: what they sell, whom they serve, their current partners, recent news and any stated partnership program or terms. Note each source. If the partner lists a process for proposals, follow it.
3. Define the fit in one sentence: why the two audiences or products belong together. If the fit is weak, say so and suggest a different partner or angle.
4. Define their gain first. List what the partner would get: new customers, a missing capability, content, lower cost, credibility. Keep to what is credible and sourced. Do not promise numbers the user cannot back.
5. Define the user's gain and the roles: who does what, who bears cost, who owns customer data and who handles support. Keep it rough; detail comes later.
6. Propose a small first step that is cheap and quick to test: a joint webinar, a pilot with five customers, a trial integration, a referral link for 60 days. Include a short test period and a measure of success.
7. Draft the pitch in this order: a one-line hook about them, the fit, what they gain, what you propose as the first step, who you are with one proof point, and a clear ask (a 20-minute call on a stated week).
8. List the open questions to settle in the call: exclusivity, branding, data sharing, payment terms, who signs. Leave legal terms for review by a qualified adviser.
9. Check the draft for length (under one page), tone and proof. Remove claims the user cannot show.
10. Prepare for objections: three likely replies and short answers.

## Gotchas

- A pitch that talks only about the sender gets ignored. Start with the partner's goals.
- A large ask in the first message (exclusive deal, big integration) scares people. Ask for a small test.
- A guessed audience or customer count about the partner looks careless. Cite their public information.
- Sending to a generic inbox goes nowhere. Find a named role responsible for partnerships.
- Terms like revenue share, exclusivity and liability need legal review before agreement.
- Follow up once or twice with something new, not "just checking in".
- Naming a big brand as a likely partner without a link to it invites silence. Show why the fit is real.

## Output

The pitch as a message or one page, followed by a short note with the sources used, the open questions list and the three objection replies. Offer `create_file` to save it.
