---
name: conversation-practice
description: Holds a free conversation in the target language pitched to the learner's level, keeps the talk flowing, and collects corrections into a short note at the end or at agreed pauses instead of interrupting. Use when the user wants to practise speaking or writing a language, asks for a conversation partner, or says "chat with me in" a language.
---

# Conversation practice

## Goal

Give the learner many turns of real communication in the target language at a level just above comfortable. Mistakes are noted without breaking the flow, and the session ends with a few useful corrections and phrases to reuse.

## When to use

- The user wants open talk on everyday topics to build fluency.
- The user wants to rehearse a defined situation with set roles: use `use_skill` with `scenario-phrasebook` to prepare first.
- The user wants a full lesson with explanation: use `language-tutor`.
- The user wants one long text corrected: use `writing-correction`.

## Steps

1. **Set up.** Use `ask_user` for the language and variety, the learner's level, the topics they like, whether they type or paste spoken text, and how they want corrections (after each turn, at the end, or only on request).
2. **Pick the register.** Match the level: short sentences and common words for beginners, natural speed and some idiom for intermediate learners. Do not slip into the learner's language unless they are lost.
3. **Open with a question.** Start with an easy, open question on a chosen topic. Ask one question per turn, so the learner is not choosing which to answer.
4. **Respond to the content.** React to what they said first, in a sentence, as a real partner would, then ask a follow-up. Meaning comes before form.
5. **Recast lightly.** If a mistake blocks understanding, repeat their sentence correctly inside your reply without comment. Mark only errors that matter for communication.
6. **Collect notes silently.** Keep a running list of errors, good phrases and missing words. Do not show it mid-flow unless they asked for per-turn fixes.
7. **Stretch gently.** Every few turns, use one new word or structure slightly above their level in a context that makes its meaning clear.
8. **Check for stuck points.** If they stall or answer in the other language, offer the missing word, give a simpler question or switch to a topic they know better.
9. **End with a recap.** After about 15 turns or on request, show three corrections with the right form and reason, two good phrases they used, and three words to learn.
10. **Offer a next step.** Suggest a topic or a drill for the next session, and offer `use_skill` with `grammar-explainer` for any recurring error.
11. **Save if wanted.** Write the recap with `create_file` so the learner can review it later.

## Gotchas

- Stopping for every error kills fluency and confidence. Correct for meaning in the flow and teach later.
- Speaking too fast or too richly shuts the learner out. Keep to their level plus a little.
- Praise without specifics does little. Name what was good, such as a correct tense in a hard sentence.
- Typed chat hides pronunciation. Say that this practice covers vocabulary and grammar, and point to `pronunciation-guide` for sound.
- Do not correct style choices as errors. Natural variation is not a mistake.
- Avoid sensitive or contested topics unless the learner raises them, since vocabulary there is hard and emotions get in the way.
- A learner who answers in single words needs easier questions, not longer ones.

## Output

During the session, short replies in the target language with one question. At the end, a compact recap with corrections, good phrases and new words.
Keep the recap under 15 lines.
