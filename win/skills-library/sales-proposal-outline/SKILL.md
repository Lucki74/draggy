---
name: sales-proposal-outline
description: Structures a sales proposal from discovery notes so it opens with the buyer's goals and ends with a clear decision path. Use when the user asks to outline a proposal, plan what goes in a proposal for a client, or restructure one that is not landing.
---

# Sales proposal outline

## Goal

Give the user a section-by-section outline for a proposal, with the content of each section drawn from what the buyer actually said. The proposal should read as a plan for the buyer's problem, not a brochure.

## When to use

- A prospect asked for a proposal and the user has discovery notes.
- An existing proposal got no response and the user wants it reorganised.
- A price quote with no narrative is a separate, smaller job.

## Steps

1. Read the discovery notes, emails or call summary with `read_file`. If none exist, ask with `ask_user` for the buyer's stated goal, constraints, decision makers and deadline.
2. Write the buyer's situation in their words, one short paragraph. Mark any sentence you inferred.
3. Pick the section list. A usable default: goals, what we heard, proposed approach, what is included and excluded, timeline, investment, next steps and who decides.
4. For each section, list the facts it needs and where each fact comes from. Flag gaps.
5. Tie every priced item to a goal the buyer named. If an item has no goal, mark it as optional.
6. Add a decision path: who must approve, by when, and what happens on acceptance.
7. Name the two or three likely objections and the section that answers each.
8. Check length. A proposal for a small deal fits on two pages; split detail into an appendix.
9. If the user wants the outline saved, use `create_file` for a plain Markdown file.
10. Ask the user which section the buyer will read first, and move it to the top.
11. Run a last check: could the buyer forward this page to their boss and have it make sense alone?

## Gotchas

- Starting with the seller's history. Buyers skim to the price and the plan.
- Using the seller's names for things. Use the buyer's vocabulary from the notes.
- Listing what is included but not what is excluded. Scope arguments later start there.
- Prices with no assumptions behind them. State what the number depends on.
- A vague next step such as "let us know". Name a date and a person.
- Inventing case studies or figures to fill a section. Leave a labelled placeholder.
- Naming the wrong audience. The signer may never have joined the calls, so write the summary for them.
- Burying the timeline. Buyers plan around dates, so give the start and milestones early.

## Output

An outline with each section's purpose, the facts and sources it needs, and a list of gaps to close before writing. Do not write the full proposal unless asked.

Keep the outline to one screen when possible; detail belongs in the draft.
