---
name: grammar-explainer
description: Explains one grammar point of a target language in plain words, with contrast examples, the common exceptions, the usual learner errors and a short drill with answers. Use when the user asks why a sentence is built a certain way, when to use a form, or for an explanation of a rule such as the subjunctive or a case ending.
---

# Grammar explainer

## Goal

Make one grammar point clear enough that the learner can use it. The explanation starts from meaning and use, keeps terminology to what the learner knows, shows the point in contrast with a close alternative, and ends with practice.

## When to use

- The user asks about a rule, a form or a sentence they cannot analyse.
- The user keeps making the same grammar error in their writing.
- The user wants their whole text corrected: use `use_skill` with `writing-correction`.
- The user wants conjugation practice only: use `verb-conjugation-drill`.

## Steps

1. **Pin the question.** Use `ask_user` for the language, the learner's level and mother tongue, and the exact sentence or point that puzzles them. One point per answer.
2. **Name the point plainly.** State what it is for in a sentence of meaning, such as "past forms show whether an action is finished", before the technical name.
3. **Give the core rule.** Two or three short statements, in order of how often they apply. Use terms the learner already uses, and define any new term once.
4. **Show examples.** Give four to six sentences from daily use, each with a translation. Highlight the part under discussion with plain markers.
5. **Contrast.** Put the point next to the one it is confused with, and show a pair of sentences that differ only in that point, with the difference in meaning.
6. **List exceptions.** Give the few that matter at this level, not every rare case. Say how common each one is.
7. **Predict the errors.** Based on the learner's language, name the two mistakes they are most likely to make and why their language pulls them there.
8. **Check against a reference.** If you are unsure of a rule or a usage trend, verify with `search_web` and `read_url` on a reputable grammar reference, and note disagreements between sources.
9. **Drill.** Write five short exercises: fill the gap, choose the form, fix the error. Keep the answers hidden until the learner tries.
10. **Mark the answers.** Check their attempts, explain each miss with the rule, and offer a second drill if two or more were wrong.
11. **Close with a rule of thumb.** One sentence the learner can carry into speaking.

## Gotchas

- Grammar terms from the learner's school may not match the target language's tradition. Ask what they know before using labels.
- Rules stated as absolutes break in speech. Say "usually" and give the main exception.
- Examples built only to show the rule can be unnatural. Use sentences someone would say.
- Registers differ: a form may be correct in writing and rare in speech. Mark which.
- Do not explain three points at once. If the sentence has several issues, rank them and handle the one that blocks meaning first.
- Descriptive and prescriptive grammar differ. When native usage departs from the textbook, report both.
- Dialects vary on endings and forms. Name the variety you describe.

## Output

The rule in plain words, the examples with translations, the contrast pair, the common errors and the drill. In chat, short paragraphs and a simple list. In a saved file, headings per part.
Keep answers short unless the learner asks for more depth.
