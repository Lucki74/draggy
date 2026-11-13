---
name: explain-concept
description: Explains a concept, idea or process at the right level for the learner, building from what they know with plain language, analogies, examples and a quick check of understanding. Use when the user asks "what is", "how does this work", "explain it simply" or "eli5".
---

# Explain a concept

## Goal

Leave the learner able to say the idea back in their own words. A good explanation matches their level, gives the answer first, and stays accurate while being simple.

## When to use

- The user asks what something is or how it works.
- The user asks for a simpler explanation or an analogy.
- For explaining a software project, use `use_skill` with `explain-codebase`.
- For checking whether a claim is true, use `use_skill` with `fact-check`.

## Steps

1. Find the level. Use clues in the question and conversation: vocabulary, stated background ("I'm a nurse", "for my 10-year-old"), and what they said they already understand. If the level really cannot be guessed, explain for a smart newcomer and offer to go deeper or simpler.
2. Build the explanation:
   1. **One-sentence answer** first: what it is and why it matters, in plain words.
   2. **Connect to something familiar:** an analogy or everyday example. Say where the analogy breaks down if that could mislead.
   3. **The mechanism:** how it works, in a few ordered steps. Introduce at most a few new terms, and define each one when it first appears.
   4. **A concrete example** worked through with real numbers or a real case.
   5. **Common misconception** about it, and why it is wrong, when there is a well-known one.
   6. **Where it leads:** one line on related ideas worth learning next.
3. Keep the style plain. Use short paragraphs and simple sentences. Prefer concrete over abstract, and pictures in words ("imagine...") for visual ideas. Use formulas or code only when the learner's level calls for it, and explain each symbol.
4. End with one short question or tiny exercise the learner can answer to test themselves, and offer to explain the answer.

## Gotchas

- Accuracy matters more than simplicity. Simplify, but never say something false.
- An analogy taken too far teaches the wrong thing. Name its limit.
- Several new terms at once overload a beginner. Define each when it first appears.
- Guessing the level too high leaves the learner behind, and too low talks down. When unsure, offer to adjust.

## Output

The explanation in the order above, closing with a check-your-understanding question.
