---
name: feynman-explain
description: Runs a teach-back check. The user explains a topic in their own simple words and the agent finds the gaps, the borrowed jargon and the shaky links in the explanation, then sends them back to repair those spots. Use when the user wants to test their understanding, says "let me explain it back", or asks for the Feynman technique.
---

# Feynman explain

## Goal

Reveal what the user does not yet understand by making them explain it. The agent does the listening and the probing. The user does the explaining and the repairing, since the repair is where the learning happens.

## When to use

- The user has studied a topic and wants to check it is solid.
- The user can recite a definition but suspects they cannot apply it.
- The user wants the agent to teach a topic from scratch: use `use_skill` with `explain-concept`.
- The user wants questions with right and wrong answers: use `quiz-me`.

## Steps

1. **Fix the topic and the audience.** Use `ask_user` to confirm the exact topic and an imagined listener, such as a bright 12 year old or a new colleague. A named listener keeps the language plain.
2. **Get the explanation.** Ask the user to write or say it without notes. Do not interrupt. If a source text exists, read it first with `read_file` so you know the correct version.
3. **Mark jargon.** List terms the user used without unpacking. For each, ask them to say it again in plain words. A term repeated but not explained is a gap.
4. **Mark leaps.** Find sentences where a step is missing, such as "so then it works because". Ask "why" or "what happens between these two".
5. **Mark errors.** Compare with the correct account. Separate wrong statements from vague ones, since they need different fixes.
6. **Ask a transfer question.** Give one small new case and ask the user to apply their explanation to it. Failure here shows a memorised, not understood, idea.
7. **Report the gap list.** Give at most four gaps, ordered by importance, each as a question the user can answer. Do not supply the answers yet.
8. **Let them repair.** The user rewrites those parts. If they stay stuck after two tries, give a hint, then a worked piece, then ask them to restate it.
9. **Re-run the weak part.** Ask the same transfer question with a different case.
10. **Close with a simplified version.** Ask the user for a final three-sentence explanation. Confirm it or correct it.

## Gotchas

- Fixing the explanation yourself defeats the method. Point at the gap and hand it back.
- Fluent wording is not understanding. Test with a new case, since memorised text cannot bend.
- Do not list every slip. Seven corrections at once bury the two that matter.
- An analogy offered by the user may be wrong in a quiet way. Ask where it stops working.
- If the topic itself is unfamiliar to you, read the source first. Probing from a guess teaches errors.
- Praise only what is specific. "Your point about pressure gradients was clear" helps, "good job" does not.
- Some topics, such as a motor skill, cannot be tested by explanation alone. Say so and suggest practice.
- A listener who nods teaches nothing. Play a curious novice who asks "and then what" until the chain is complete.

## Output

A short list headed by what was clear, then the gaps as questions, then the transfer case. In later rounds, a brief note on which gaps closed. No lecture and no full re-teaching unless the user asks.
