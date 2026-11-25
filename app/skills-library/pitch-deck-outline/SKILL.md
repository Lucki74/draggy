---
name: pitch-deck-outline
description: Plans a pitch deck slide by slide for a named audience and a clear ask, with the story order, what each slide must prove, the evidence needed and a note on what to leave out. Use when the user asks for a pitch deck outline, an investor deck structure, or help organizing a presentation to persuade.
---

# Pitch deck outline

## Goal

A slide-by-slide plan where each slide has one message, the proof for it and the question it answers for the audience. The deck tells one story and ends with a specific ask. It is an outline, not the finished slides.

## When to use

- The user is preparing to pitch investors, a board, a customer, a partner or an internal committee.
- The user has material but no structure.
- For a single-page version, use `use_skill` with `one-pager`.
- For the written recommendation behind it, use `use_skill` with `strategy-memo`.
- For the number work, use `use_skill` with `business-model-canvas` to check the model first.
- The user wants to review an existing deck's story and find which slides do not earn their place.

## Steps

1. Ask with `ask_user` who the audience is, how long the talk is, whether the deck is presented or read alone, and the exact ask (money, a pilot, a decision, a signature). Different asks need different decks.
2. Collect the material. Read notes, plans and data files with `read_file`. List what exists: customer evidence, product, numbers, team. List what is missing.
3. Find the core claim in one sentence: why this, why now, why us. Every slide should serve it.
4. Choose a story order. A common order is: title with the one-line pitch, problem, who has it, solution, how it works (a demo or picture), evidence it works (customers, pilots, results the user can show), market, business model, go-to-market, competition and edge, team, plan and milestones, financial summary if relevant, the ask and use of funds or next steps. Drop slides the audience does not need.
5. For each slide write: the headline as a full sentence stating the takeaway, the supporting proof, and the visual to use (chart, screenshot, quote, diagram). Avoid lists of bullets as the only visual.
6. Mark evidence status for each claim: shown (the user has it), needed (the user must get it), or assumed. List the needed items as work to finish before the pitch.
7. Treat numbers carefully. Use only figures the user supplies or sources with `search_web`. Do not invent market sizes, growth rates or customer counts. Label projections as projections with their assumptions.
8. Limit length. Aim for about ten to fifteen slides for a 20-minute talk, fewer for short slots. Move detail to an appendix list.
9. Prepare for questions: list the five hardest questions the audience may ask and where the answers are.
10. Check the arc by reading only the headlines in order. They should read as the argument. Fix any gap.

## Gotchas

- Putting the ask at the end without stating it earlier leaves the audience guessing why they are there.
- Market-size slides built from top-down percentages persuade nobody. Show the reachable first segment.
- A claim like "no competition" signals missing research. Show the alternatives.
- Reading dense slides aloud wastes the room. One message per slide.
- Financial projections without assumptions are decoration. List the drivers.
- Do not promise returns or outcomes. For fundraising terms, suggest a qualified adviser.
- A deck sent by email must stand alone. A deck presented live can leave the explanation to the speaker.

## Output

A numbered list of slides with Headline, Proof and Visual, an Evidence status table, the list of hard questions and the appendix list. About two pages.
