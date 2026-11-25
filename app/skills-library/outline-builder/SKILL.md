---
name: outline-builder
description: Turns a topic, a pile of notes or a brief into a working outline in which every section states its own point, ordered for the reader rather than for the notes. Use when the user asks to outline an article, report or talk, to structure scattered notes, or asks what sections a piece should have.
---

# Outline builder

## Goal

Give the writer a plan they can draft from without stalling. A good outline names the one thing the piece says, gives every section a claim in a full sentence, orders sections for the reader's questions, and marks what evidence each section still needs.

## When to use

- The user has a topic and no structure.
- The user has notes, quotes or data in no order and wants a skeleton.
- A draft feels unfocused and a reverse outline would show why.
- For turning the outline into a finished post, use `use_skill` with `blog-post`.
- For a formal report layout, use `use_skill` with `report`.

## Steps

1. Collect inputs. If notes are in a file, `read_file` it. Ask with `ask_user` for four things not already clear: the reader, what that reader should think or do afterwards, the length or format, and anything that must be included.
2. Write the thesis in one sentence: the claim or the answer the piece gives. If notes support several, ask which one this piece is for and park the rest.
3. Sort the notes into clusters by what they say, not by where they came from. Drop or park anything that does not serve the thesis; list parked items at the end.
4. Order the clusters for the reader. Common orders: problem, cause, fix; claim, evidence, objection, reply; chronological with a point at each step; most important first for readers who stop early. Pick one and say why.
5. Write each section as a heading plus a one-sentence claim ("Pricing fell because suppliers merged"), not a topic label ("Pricing"). Under it, list the evidence that will support it, taken from the notes.
6. Mark gaps: sections whose claim has no support in the notes. Write what is needed (a number, an example, a quote) without inventing it.
7. Set proportions. Give each section a rough share of the length so the draft does not spend half its words on setup.
8. Test with a reverse read: read only the claim sentences in order. They should form the argument. If a claim does not follow from the one before, reorder or merge.
9. Keep levels shallow: two levels are enough for most pieces. Save the outline with `create_file` if the user wants a file.
10. Hand the outline to the user for one decision before drafting: the thesis and the order. Changing them later costs the most.
11. When drafting begins, keep the outline open and update it if a section changes its claim.

## Gotchas

- Topic headings feel like progress and hide the lack of a point. If a heading could be a library category, it is not a claim yet.
- An outline that mirrors the order of the notes records research order, not reading order. Reorder.
- Adding detail levels early locks in structure before it is tested. Settle sections first, then bullets.
- An introduction and a conclusion section as defaults produce filler. Include them only if they would hold something specific.
- Evidence listed as "stats on this" is a wish. Mark it as a gap until the figure exists.
- For a talk, the audience cannot reread. Add repetition points and signposts the page would not need.
- Outlines for argument pieces need the objection section. Leaving it out makes the draft read as one-sided.
- Equal-sized sections look tidy and rarely match the importance of the points. Let the length follow the weight.
- A source list is not an outline. Group by what the sources say, and cite them under the claim they support.
- Pieces with a required template (a grant form, an academic journal) need the template headings first, then the claims inside them.
- Do not outline a point the user has not yet decided to make. Ask, then outline.

## Output

- The thesis sentence.
- The outline: numbered sections, each with its claim sentence, the supporting material, and an approximate share of length.
- A list of gaps to fill and a list of parked material.
- One sentence on why the order was chosen.
