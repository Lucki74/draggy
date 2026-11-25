---
name: value-proposition
description: Drafts a value proposition by matching a named customer's jobs, pains and desired gains to what the product actually does, then writes a headline, a subhead and proof points. Use when the user asks to write a value proposition, explain why customers should choose them, or fix a homepage promise that is vague.
---

# Value proposition

## Goal

A promise a specific customer finds relevant, believable and different. It connects a real customer problem to a concrete result and shows the evidence for it.

## When to use

- The user's pitch or homepage says what the product is but not why anyone should care.
- The user wants a headline and supporting lines for a product, plan or feature.
- For internal positioning across the company, use `use_skill` with `positioning-statement`.
- For the underlying customer needs, use `use_skill` with `jobs-to-be-done`.
- For a pitch to a company that could partner, use `use_skill` with `partnership-pitch`.
- A feature launch needs one clear line on why users should care.

## Steps

1. Ask with `ask_user` for the product, the customer segment, and the most common reasons customers buy or leave. Open any notes with `read_file`. If the customer is "everyone", pick a first segment with the user.
2. List the customer's jobs (what they are trying to do), pains (what makes it hard, costly or risky) and gains (what a good result looks like). Use the customer's words from reviews or calls where the user has them.
3. List what the product does that relates to those items: the features, services and guarantees. Ignore anything with no link to a job, pain or gain.
4. Match. For each major pain, name the product element that relieves it and the result for the customer. For each gain, the element that creates it. Mark gaps where the product does nothing.
5. Pick the strongest match: the pain that hurts most, that the product solves best, that rivals solve worse. This becomes the core of the promise.
6. Write the headline as the result for the customer in plain words, ideally with a measurable or visible change. Write a subhead that says what the product is and for whom. Write three proof points: a fact, a customer result the user can show, or a guarantee.
7. Check believability. For each claim, ask what a doubtful buyer would say. Add proof or soften the claim.
8. Check difference. Cover the product name; could a rival use the same line? If so, add the specific mechanism or audience.
9. Offer two alternative headlines in different angles (outcome, risk removed, speed) and ask the user which one the customer would pick.
10. Recommend a way to test the pick: a short customer call, two landing pages, or an ad pair.

## Gotchas

- Feature lists are not a value proposition. Convert each into what it changes for the customer.
- "Save time and money" fits any product. Name which time and which money.
- Numbers must come from the user's own data or a cited source. Never invent a percentage.
- A promise the product cannot deliver causes churn and bad reviews.
- Writing for the buyer when the user is someone else (such as admin versus end user) misses the person who must be convinced.
- Cleverness reads worse than clarity. Test the line on someone outside the company.
- A proposition for a B2B buyer often needs a second line for the person who signs off, who cares about risk and cost.

## Output

A value map (Jobs, Pains, Gains, Product elements), then the chosen Headline, Subhead and three Proof points, two alternates, and the test plan. About one page.
