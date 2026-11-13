---
name: ad-copy-variants
description: Writes several distinct ad copy variants for a platform, each with a different angle, checked against that platform's current character limits and ad policies, plus a plan for what each variant tests. Use when the user asks for ad copy, ad headlines, search ads or social ad text with multiple options to test.
---

# Ad copy variants

## Goal

A set of ads that differ in the idea they test, beyond wording. Each fits the platform's current limits, follows its policies and sends the click to a page that keeps the promise.

## When to use

- The user is running or starting paid ads on search, social or display and needs copy to test.
- Existing ads have stalled and need fresh angles.
- For the page the ad leads to, use `use_skill` with `landing-page-copy`.
- For the test design and sample logic, use `use_skill` with `a-b-test-plan`.
- For short headlines outside ads, use `use_skill` with `headline-writer`.

## Steps

1. Ask with `ask_user` for the platform and ad format, the product, the audience, the single goal (click, lead, sale), the offer, the landing page, the market and language, and any words or claims that are banned or must appear.
2. Look up the platform's current limits for the format with `search_web` and open the official help page with `read_url`. Record headline, body and link text limits with the date checked. Limits change, so do not trust memory.
3. Check the platform's ad policies for the product category. Note restricted claims, personal attributes targeting, health, finance and comparison rules.
4. List angles worth testing: a pain point, an outcome, a price or offer, social proof the user really has, urgency that is real, a question, a comparison that is allowed. Choose four to six.
5. Write one variant per angle. Each gets headline, body and call to action in the limits. Keep one idea per ad and one action.
6. Count characters with `run_command` for every field. Reject any that go over.
7. Check each variant against policy and against the page: the claim must be true and visible after the click, including price and terms.
8. Label what each variant tests, and the one thing that stays constant so results can be read. For search ads, note the keywords or intent each variant suits.
9. Suggest negative angles to avoid and an order to roll out. Do not predict click rates; no benchmark is claimed.
10. Offer to adapt winners into other sizes or platforms after results arrive.

## Gotchas

- Character limits change and differ by placement. Check the official page and note the date.
- Claims about health, income or guaranteed results are often disallowed or require proof. Remove or soften them.
- Variants that differ only by synonyms teach nothing. Change the angle, not the adjective.
- Fake urgency and fake scarcity harm trust and can break policy.
- Using the competitor's brand name in ad text may be restricted. Check policy.
- Copy that over-promises raises clicks and lowers conversions. Match what the page delivers.
- Ad accounts differ in what they allow, and approval can be refused after launch. Submit for review early.

## Output

A table with Variant, Angle, Headline, Body, Call to action, Character counts, What it tests. Below: limits source and date, policy notes and the rollout order.
