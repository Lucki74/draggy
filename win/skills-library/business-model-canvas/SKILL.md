---
name: business-model-canvas
description: Fills in the nine blocks of a business model canvas for a business or idea and checks that the blocks agree with each other, from customers and value to revenue and costs. Use when the user asks for a business model canvas, wants to map how a business works, or asks how an idea makes money.
---

# Business model canvas

## Goal

A one-page picture of how a business creates, delivers and earns from value. The blocks are specific, consistent with each other, and mark what is known versus guessed.

## When to use

- The user is starting a business or testing an idea and needs the model on one page.
- The user wants to explain or review how an existing business works.
- For a message to customers, use `use_skill` with `value-proposition`.
- For testing which parts might be wrong, use `use_skill` with `assumption-test-plan`.
- For prices in detail, use `use_skill` with `pricing-strategy-options`.
- The user is preparing an application, class assignment or advisor meeting that expects a canvas.

## Steps

1. Ask with `ask_user` what the business or idea is in two sentences and who it serves. Ask whether it exists today.
2. Start with Customer segments. Name one to three groups with a defining trait that changes what they need. "Small businesses" is too broad; "solo accountants with under 30 clients" works.
3. Fill Value propositions per segment: the problem solved or the gain created, in the customer's terms.
4. Fill Channels (how customers learn, buy and get the product) and Customer relationships (self-service, personal help, community).
5. Fill Revenue streams: who pays, for what, how (subscription, per use, one-off, fee). If the payer differs from the user, note it. Do not state prices unless the user gives them.
6. Fill Key resources, Key activities and Key partners: what the business needs to own, do and rely on others for.
7. Fill Cost structure: the main costs by type (people, tools, hosting, stock, acquisition) and whether each is fixed or varies with volume.
8. Check consistency across blocks. Each segment has a value proposition, a channel to reach it and a revenue stream. Each revenue stream is supported by activities and resources. Costs match activities. Flag every break.
9. Mark each cell as known (evidence) or guess. Pick the three guesses with the biggest effect and list them as items to test.
10. Present the nine blocks in the standard grid order and save with `create_file` if wanted.

## Gotchas

- A canvas for "everyone" tells nothing. Pick a first segment and park the others.
- A revenue stream with no named payer is a hope. Name who pays.
- Value propositions written as features miss the point. Write the job done or the pain removed.
- Cost blocks often leave out acquisition and support. Include them or the margin looks too good.
- Do not fill with market sizes or prices from memory. If the user needs them, find sources with `search_web` and cite them.
- The canvas is a draft to revise as evidence arrives, not a plan to defend.
- Multi-sided businesses (a marketplace, an ad-funded app) need one set of segments per side, with the link between them drawn.

## Output

The nine blocks as a labeled list or text grid, with one to four bullets each, a Consistency issues list, and Top three guesses to test. About one page.
