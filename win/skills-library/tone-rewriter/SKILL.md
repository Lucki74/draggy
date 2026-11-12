---
name: tone-rewriter
description: Rewrites a text for a different tone, audience or length (more formal, friendlier, more confident, simpler, shorter) while keeping every fact and intent. Use when the user asks to make something sound different, soften or tighten a message, or fit a new reader.
---

# Tone rewriter

## Goal

Keep what the text says and change how it sounds. Every fact, number, commitment and request survives, and the result reads naturally in the new tone.

## When to use

- The user asks for a text to be more formal, friendlier, more confident, more diplomatic, simpler or shorter.
- The user wants the same message adapted to a different reader or medium.
- For fixing only spelling and grammar, use `use_skill` with `proofreader`.
- For writing an email from scratch, use `use_skill` with `email-writer`.

## Steps

1. Identify what must survive: facts, numbers, commitments, requests, deadlines, and the author's goal.
2. Identify the target: the tone the user asked for, the reader, and the medium (email, chat message, website, report, speech). If the target is vague ("make it better"), choose the most likely one from context and name it in one line before the rewrite.
3. Apply the tone moves:
   - **More formal:** full sentences, no contractions or slang, precise verbs, polite framing of requests.
   - **Friendlier:** contractions, direct "you", warmer openings and closings, shorter sentences. Not gushing.
   - **More confident:** remove hedges ("I think", "maybe", "just"), use active voice, state recommendations as recommendations.
   - **More diplomatic:** acknowledge the other side, focus on the issue rather than the person, offer a way forward.
   - **Simpler:** everyday words, one idea per sentence, explain jargon or remove it. Aim for a reader aged about twelve unless told otherwise.
   - **Shorter:** cut throat-clearing, repetition and qualifiers first, then merge sentences. Say how much shorter it got.
4. Compare the rewrite with the original against the list from step 1. Restore anything lost.

## Gotchas

- Softening a complaint or condition until it disappears changes the message. Keep it, just phrase it kindly.
- Cutting hedges in a text where the author truly is unsure turns doubt into a false claim.
- Friendlier tips into gushing when every sentence gets an exclamation mark.
- Cutting for length tends to remove the one deadline or number that mattered.

## Output

The rewritten text, ready to use. If the rewrite had to drop or soften anything that might matter (a complaint, a condition), list it in one line after the text. Offer at most two alternatives, and only if asked.
