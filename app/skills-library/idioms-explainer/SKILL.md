---
name: idioms-explainer
description: Explains an idiom, proverb or set phrase from a foreign language, giving its real meaning, tone, register, how common it is, where it is used and a natural equivalent in the learner's language, without invented origin stories. Use when the user asks what an expression means, how natives would say something, or whether a phrase is safe to use.
---

# Idioms explainer

## Goal

Tell the learner what the expression does in real speech: what it means, when people say it, what tone it carries and what to say in their own language. They should be able to decide if they want to use it themselves.

## When to use

- The user meets a phrase in a show, book or chat that does not make sense word for word.
- The user wants a natural way to say something in a target language.
- The user wants words to study: use `use_skill` with `vocabulary-builder`.
- The user wants to check a translated text for naturalness: use `localization-check`.

## Steps

1. **Get the phrase and the setting.** Use `ask_user` for the exact wording, the language and variety, and where it appeared (who said it to whom). Setting often decides the meaning.
2. **Read it literally first.** Give the word-for-word gloss in a line so the learner sees why it is confusing. Keep it brief.
3. **Give the real meaning.** Explain in plain words what speakers mean. Confirm with a dictionary or usage source found by `search_web` and opened with `read_url`.
4. **State the register.** Mark it as formal, neutral, informal, slang, vulgar, old-fashioned or regional. Note the age group or setting where it fits.
5. **State the tone.** Say whether it is warm, ironic, harsh or neutral, and whether it can offend. Name situations where it would sound odd.
6. **Judge frequency.** Say if it is common, occasional or rare, or tied to a decade or a region. Do not guess. If you cannot find evidence, say that.
7. **Give examples.** Two or three sentences in the target language with translations, showing different contexts or forms, such as tense changes the idiom allows.
8. **Offer equivalents.** Give a natural expression in the learner's language that does a similar job, and mention where the match is imperfect.
9. **Handle origin carefully.** Give an origin only when a reliable source supports it. Otherwise say the origin is unclear or disputed.
10. **Give a safe alternative.** A plain phrase the learner can use if they do not want to risk the idiom.
11. **Quiz.** Offer two short situations and ask which expression fits.

## Gotchas

- Folk etymologies spread widely and are often wrong. Do not repeat one without a source.
- Idioms are fixed. Changing a word, a tense or an article can break them or turn them into a joke.
- Equivalents are rarely exact. A near match in the learner's language may carry another tone.
- Slang ages in a few years and varies by city. Name the place and period when you can.
- A learner who overuses idioms sounds odd. Advise saving them for when the situation fits.
- Some phrases are taboo or insulting in one region and mild in another. Warn before suggesting use.
- Proverbs are used as quotes, not as part of normal sentences. Show how people introduce them.

## Output

Literal gloss, meaning, register and tone, frequency, two examples with translations, equivalent, safe alternative. Keep it to about a dozen lines.
Group several phrases into a list with the same fields.
