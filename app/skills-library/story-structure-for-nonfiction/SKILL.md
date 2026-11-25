---
name: story-structure-for-nonfiction
description: Shapes an essay, article, case or talk around a narrative spine of a question or tension, turning points and a payoff, using only facts the author has, so true material reads as a story. Use when the user asks to make nonfiction more engaging, give an article a narrative arc, or structure a story from facts.
---

# Story structure for nonfiction

## Goal

A true account that pulls the reader through. A good result finds the question or tension in the material, orders events or ideas so each answer raises the next question, puts a concrete scene or fact at the front, and lands on something the material earns.

## When to use

- An essay, feature, talk or case history is accurate but flat.
- The user has facts, interviews or a timeline and no shape.
- For invented stories and fiction, use `use_skill` with `story-writer`.
- For a bare outline of an argument, use `use_skill` with `outline-builder`.

## Steps

1. Read the material with `read_file`. List what is actually known: events with dates, people with roles, quotes, numbers, documents. Mark what is thin or uncertain.
2. Find the spine. Ask: what did someone want, what stood in the way, what happened, and what changed? For an idea piece, ask what puzzle or mistaken belief the piece resolves. State it in one or two sentences. If there is none, ask the author with `ask_user` what surprised them.
3. Choose the opening from real material: a moment, a number, a document, a decision. It must be something that happened or exists in the sources, with enough detail to be concrete. Do not construct a scene from imagination.
4. Order the middle by tension. Chronological is the default and often right. Otherwise, start at the turning point and step back. Each section should end by opening the next question or adding a complication.
5. Place the needed explanation where the reader first needs it, not in front. Background that comes before the question feels like homework.
6. Choose a turning point: the fact or event after which the situation is different. Make sure it is shown before it is explained.
7. Write the ending from the material: the outcome, the cost, what remains unresolved. If the story is open, leave it open. Do not add a moral the facts do not support.
8. Check each section for a gap between claim and evidence. Where a transition needs a fact you do not have, list it as a question for the author instead of filling with plausible detail.
9. Produce the structure as a beat sheet with a line or two per beat, then draft only if asked. Save with `create_file`.
10. Test the shape with a one-sentence version: "X wanted Y, but Z, so..." If it does not fit in a sentence, the spine is not found.
11. Decide the point of view and keep it: first person, a named subject, or a neutral narrator.

## Gotchas

- Inventing a scene, a thought or a quote to make a beat work turns a true piece into a false one. Use what exists, or mark the gap.
- A formula (hook, struggle, lesson) applied mechanically produces the same piece every time. Fit the shape to the material.
- Holding back the point too long loses readers who came for it. State the stakes early, and delay only the answer.
- Reconstructing a person's feelings without a source is speculation. Report what they said or did.
- Chronology can bury the interesting part. Test starting at the turn.
- A neat ending to an untidy situation reads false. Leave real uncertainty visible.
- Real people in the account have a stake in how they appear. Check quotes and characterisations with the facts, and flag anything sensitive.
- Composite characters and compressed timelines are disclosed in nonfiction, or avoided. Never blend silently.
- A dramatic structure can imply cause where there was only sequence. Say "after" and not "because" unless the evidence shows it.
- Talks need repetition and signposts that print does not. Add them when the form is spoken.
- Long pieces need small payoffs along the way, not one at the end.

## Output

- The spine in a sentence or two.
- A beat list: opening, key turns, ending, each with its source fact.
- Gaps and questions for the author, kept apart from the beats.
- Optionally a draft of the opening paragraph to show the intended voice.
