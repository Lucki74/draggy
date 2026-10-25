---
name: slide-outline
description: Plans a presentation as a slide-by-slide outline where each slide carries one claim, sized to the audience and the time available. Use when the user asks to outline a presentation, plan slides for a talk, or asks how many slides they need.
---

# Slide outline

## Goal

Give the user a deck plan they can build in an hour: a storyline, a count that fits the time, and for each slide a one-sentence claim plus the evidence that backs it. A good outline can be read top to bottom as the argument of the talk.

## When to use

- The user has a topic, a document or notes and needs a deck structure.
- The user asks how long a talk should be or how many slides to make.
- For writing what to say on each slide, use `use_skill` with `presentation-speaker-notes`.
- For building the actual .pptx file, use `use_skill` with `pptx`.

## Steps

1. Ask the three questions that decide everything with `ask_user`: who is the audience and what do they already know, how many minutes is the slot including questions, and what should they think or do afterwards. If the user gave source material, read it with `read_file` first and ask only what remains.
2. Set the budget. Plan roughly one slide per one to two minutes for a talk, less for dense technical slides, and keep the questions time out. State the number you are aiming for and why.
3. Write the single takeaway as one sentence. If it needs two sentences, it is two talks, so ask which one.
4. Choose the arc that fits: problem, evidence, proposal, ask for a decision talk; context, findings, implications for a report-out; step order for a how-to. Do not default to history first.
5. Draft the slides as a numbered list. Each line holds the claim as a full sentence ("Support tickets doubled after the March release"), then the evidence it needs (a chart, a quote, a number from the source), and the slide type (title, chart, image, comparison, summary).
6. Cut. Merge slides that share a claim, remove any slide that does not support the takeaway, and move detail to a backup appendix.
7. Check coverage: every claim traces to source material or is marked as needing data. Mark invented numbers as gaps, never fill them in.
8. Present the outline with the time estimate per section. Use `update_plan` if the user will build the deck in stages, and save the outline with `create_file` on request.
9. Test the outline against the audience before the user builds anything.
   - Read only the claims in order and check that they tell the story alone.
   - Ask what the most skeptical person in the room would object to, and check that a slide answers it.
   - Check that the ask or next step appears on the second to last slide, not as an afterthought.
   - Count again: slides divided by minutes should still be near the budget.
10. Offer the next step: speaker notes or building the deck, each with its own skill.

## Gotchas

- Topic titles such as "Results" or "Market" say nothing. A slide title that is a claim lets the audience follow with the notes closed.
- An agenda slide in a ten-minute talk spends a minute on nothing. Skip it below about twenty minutes.
- Starting with company background loses the room. Open with the problem or the result.
- Counting slides without counting time leads to a deck that overruns. Dense chart slides take longer than quote slides.
- Never invent figures to make a slide look complete. Write "needs: Q3 churn number" instead.
- A deck for reading (sent ahead) needs more text per slide than a deck for speaking. Ask which one it is, because the outline differs.

## Output

- The audience and the desired outcome, restated in one line each.
- The takeaway sentence, the time budget and the slide count.
- A numbered outline: claim, evidence, slide type, with sections marked.
- A short list of missing data and a note on what moved to the appendix.
