---
name: email-sequence-marketing
description: Designs a marketing email sequence such as welcome, nurture or onboarding, with one goal per email, timing, subject lines, bodies and a clear unsubscribe path, built on consented subscribers. Use when the user asks for an email sequence, drip campaign, welcome series or automated marketing emails.
---

# Marketing email sequence

## Goal

A short sequence in which each email has a single purpose and moves the reader one step toward the goal. Timing respects the reader, the content is useful, consent and unsubscribe rules are met, and every claim is true.

## When to use

- The user wants a welcome series for new subscribers, onboarding for new customers or a nurture track for leads.
- The user wants to revive lapsed subscribers or follow up after a download or webinar.
- For a single newsletter issue, use `use_skill` with `newsletter`.
- For one-to-one sales email, use `use_skill` with `cold-outreach`.
- For general email drafting, use `use_skill` with `email-writer`.

## Steps

1. Ask with `ask_user` for the audience and how they joined, the product, the goal of the sequence (first purchase, activation, booking, reactivation), the sending tool, brand voice and any legal constraints. Confirm that recipients opted in, since a sequence to people who never consented is not acceptable.
2. Define the journey: where the reader starts, what they need to know and believe, and what single action ends the sequence. Name the goal metric, such as purchases or activations, and the baseline if the user has it.
3. Plan the number of emails by the journey, not a template. Often four to six cover it. Give each email one job: welcome and promise, quick win, story or proof, objection, offer, last reminder.
4. Set timing. Send the first email right after sign-up, then space the next ones by how long the reader needs to act on the last. Give the reason for each gap. Add exit rules: stop when the reader converts or replies.
5. Write subject lines (two options each) and preview text. Make them specific and honest, free of misleading "Re:" or fake urgency.
6. Write each body: a short opening that continues the story, one idea, a clear single call to action, and a signature from a real sender. Keep it scannable. Use facts the user supplied; do not invent testimonials or numbers.
7. Include the required elements: sender identity, a working unsubscribe link, a postal address where the law requires it and a way to reply. Check the applicable rules for the audience's region with `search_web` if unsure, and tell the user to confirm with counsel.
8. Plan segmentation and branching only where it changes the message, such as buyers versus non-buyers. Keep the main path simple.
9. Set up measures: opens are unreliable on their own, so prefer clicks, replies and conversions. Define what to review after the first run and which email to change first.
10. List the tests to try later, one at a time, such as subject lines or send time. See `a-b-test-plan`.

## Gotchas

- Sending too many emails too fast drives unsubscribes and spam reports. Pace by what the reader can do.
- A missing or hidden unsubscribe path breaks the rules and harms deliverability.
- The same goal in every email makes the sequence repetitive. Vary the job of each one.
- Fake countdowns and invented scarcity damage trust and may be unlawful.
- Mail clients cut or block images. Make each email work as plain text.
- Do not send to purchased lists.
- Automations keep running after offers change. Add a review date and an owner so stale emails get caught.

## Output

A sequence table (email, day, goal, subject options, call to action) followed by the full text of each email, exit rules, legal checklist and measures.
