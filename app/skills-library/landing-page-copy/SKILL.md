---
name: landing-page-copy
description: Writes landing page copy around one visitor, one promise and one call to action, with a headline, proof, benefits before features, objection handling and a closing ask, using only facts the user can back up. Use when the user asks for landing page copy, a sales page, a hero section or a page that must convert visitors.
---

# Landing page copy

## Goal

Copy for one page with one job. A visitor who arrives from a known source understands the offer in seconds, trusts it with real proof and knows the single next step. Nothing on the page is invented.

## When to use

- The user is launching a product, service, event or lead magnet and needs the page text.
- An existing page gets visits but few sign-ups and needs a rewrite.
- For the value statement behind the page, use `use_skill` with `value-proposition`.
- For the positioning to hold the page together, use `use_skill` with `positioning-statement`.
- For product text on a shop listing, use `use_skill` with `product-description`.

## Steps

1. Ask with `ask_user` for the offer, the one action wanted, the visitor and where they come from (ad, search, email), what they believe before arriving, price or terms, and the proof available. Read any brief or notes with `read_file`.
2. Write the promise in one sentence: who gets what result, in what time or effort, without which pain. If the user cannot state it, stop and shape it first.
3. Check how rivals pitch the same offer with `search_web` and `read_url`. Note claims everyone makes and the gap you can own.
4. Draft the headline to match the traffic source, so the visitor sees the words they clicked on. Write three options. Add a subhead that says how it works or who it is for.
5. Write the proof block near the top: real numbers, named customers, logos, quotes or certifications the user supplied. Mark each with its source. If there is none, use a plain guarantee or a clear description of the process, and flag that proof is missing.
6. Write benefits first: for each, the outcome the visitor wants, then the feature that delivers it, then a detail that makes it believable.
7. Show how it works in three or four steps, so the effort looks small and clear.
8. Handle objections: price, risk, time, fit, switching cost. Use a short FAQ or inline answers. Answer with facts only.
9. Write the call to action as a verb phrase that names what happens next ("Get the checklist"). Repeat the same action at the top, middle and end. Add a line that lowers risk, such as a trial or refund, only if it is real.
10. Check the whole page: one goal, one audience, no jargon the visitor would not use, every claim backed. Cut anything that serves no step toward the action.

## Gotchas

- Invented testimonials, user counts or ratings are deceptive and can break advertising rules. Use none rather than fake ones.
- Several different calls to action split attention. Keep one primary action; a secondary link must not compete.
- Feature-first copy describes the product, not the visitor's gain. Lead with the result.
- A headline that does not match the ad or link that brought the visitor feels like a bait and switch.
- Superlatives without proof ("best", "revolutionary") are noise. Replace with a concrete detail.
- Time-limited offers must be genuinely limited. Do not fake countdowns.
- Legal text, pricing and claims in regulated areas need the user's review before launch.

## Output

Headline options, subhead, then the page in section order with each block labeled (proof, benefits, how it works, objections, call to action). Add a list of claims that still need proof and one test idea. See `a-b-test-plan` if the user wants to test headlines.
