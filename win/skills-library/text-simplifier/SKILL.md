---
name: text-simplifier
description: Rewrites a text in the target language at a lower reading level for a learner, shortening sentences, swapping rare words and keeping the meaning, with a glossary of the words that stayed. Use when the user has an article, story or message that is too hard to read and wants a version they can follow.
---

# Text simplifier

## Goal

Produce a version of the user's own text that a learner at a stated level can read with little help, without changing what it says. The learner should be able to compare both versions, so the original stays beside the new one.

## When to use

- The user pastes or points to a text in a language they are learning and finds it too hard.
- The user wants a series of versions from simple to original, for step-up reading.
- The user wants a fresh text instead: use `use_skill` with `reading-graded-text`.
- The user wants a translation, not a simplification: use `translator`.

## Steps

1. **Get the inputs.** Use `ask_user` for the language, the target level, the purpose (study, reading aloud, class) and whether to keep names, numbers and quotes untouched. Read the file with `read_file` if one is given.
2. **Read for meaning.** Summarise the text in two lines for yourself. Everything in the simplified version must serve that meaning.
3. **Find the blockers.** Mark long sentences, passive or subordinate chains, rare words, idioms, and references that need background.
4. **Cut sentence length.** Split long sentences into two or three, one idea each. Move the subject and verb early.
5. **Swap vocabulary.** Replace rare words with common ones of the same sense. Keep a word if it is essential to the topic, and gloss it instead.
6. **Simplify grammar to the level.** Prefer the tenses and structures the learner knows. Replace constructions above the level with plain ones, and keep the order of events.
7. **Handle idioms.** Replace figurative phrases with literal ones, or keep one and explain it in the glossary.
8. **Keep facts intact.** Check every number, name, date and claim against the source. Remove nothing that changes the argument, and mark any cut.
9. **Check the result.** Reread as a learner. If a sentence still needs a dictionary, fix it. Verify doubtful usage with `search_web`.
10. **Gloss.** List 5 to 10 words kept from the original with plain meanings.
11. **Write the output.** Save the simplified text beside the original using `edit_file` on a copy or a new file, and keep the original intact.

## Gotchas

- Over-simplifying removes nuance and tone. Say what was lost when the source was subtle.
- Shorter sentences can read choppy. Join them with simple connectors where the level allows.
- Dropping a hard sentence can change the claim. Simplify it, do not skip it.
- Facts in news, medical or legal text must not shift. If the topic is risky, warn the reader that the simplified version is for study only.
- A level label is approximate. Check with the learner whether it felt right.
- Keep the author's order of ideas unless it blocks understanding.
- Do not rewrite quotes. Mark them as quotes and gloss the hard words.

## Output

The simplified text, a glossary, and a short list of what was changed or cut. Mention the level you aimed for.
Place the original beside the new version when saving.
