---
name: shorten-text
description: Cuts a text to a stated word, character or page limit by removing filler and repetition first, then lower-value points, and checks the count with code so the target is met exactly. Use when the user asks to shorten something, cut it in half, or make it fit a limit.
---

# Shorten text

## Goal

Hit the length limit and keep what the reader needs. A good result is at or under the target when measured by a script, keeps the main claim and the strongest evidence, and tells the user what was removed so they can overrule it.

## When to use

- A text must fit a limit: abstract, bio, application field, post, slide, summary.
- The user says "cut this in half" or "tighter".
- For a summary written fresh from a long source, use `use_skill` with `summarizer`.
- For making unclear text clearer without a length goal, use `use_skill` with `clarity-edit`.

## Steps

1. Pin down the target. Ask with `ask_user` if missing: the unit (words, characters with or without spaces, lines), whether it is a hard cap, and where it is counted (a form field may count differently from a word processor).
2. Measure the original with `run_code`: a few lines that count words (split on whitespace) or characters. Do this again at the end. Do not count by eye.
3. Identify what the reader must keep: the main claim, the decision or action requested, the facts that carry the claim, names and numbers. Mark them.
4. Cut in layers, stopping when the target is met:
   - Layer 1, filler: throat-clearing openers, stacked hedges, repeated points, "in order to", "the fact that", restated conclusions.
   - Layer 2, wording: phrases to words, nominalisations to verbs, doubled adjectives.
   - Layer 3, content: examples beyond the best one, background the reader already has, secondary points. Remove the least important first.
5. Rewrite instead of deleting when a cut breaks the flow. A paragraph made of leftover sentences reads badly; recompose it.
6. Re-measure with `run_code`. If still over, go to the next layer. If you overshoot by a lot, restore the best item removed.
7. Check the result reads as a whole: the opening still sets context, the end still lands, no pronoun lost its referent.
8. Write to the file with `edit_file` if the text lives in one, otherwise return it in chat.
9. Keep the original: if the user edits a file, say where the full version stays so a cut can be undone.
10. If asked for several lengths (50, 100, 200 words), build them from the shortest up, so each longer one adds to the shorter.

## Gotchas

- Cutting from the end first deletes the conclusion. Cut filler throughout, then low-value content, wherever it sits.
- Evidence goes before assertions in many people's cuts. A claim without its one supporting number is weaker than a claim with it plus less decoration.
- Word counters disagree on hyphenated words, numbers and URLs. Use the same rule the destination uses, and say which you used.
- A limit "of about 200 words" has slack; a form field has none. Treat form fields as hard.
- Shorter text is not always clearer. Compression into dense noun stacks makes a text hard to read. Keep verbs.
- Do not alter quotes, figures or names while trimming around them. Cut a quote by dropping a whole sentence, not by editing its words.
- Cutting adjectives and adverbs blindly removes qualifiers that change meaning ("rarely", "only"). Read each before deleting.
- Titles, headings and captions count toward a limit in some forms and not in others. Ask which.
- Bullet lists save words only if the bullets are real parallels. Otherwise they add fragments.
- Replacing a name with a pronoun to save a word can leave the reader unsure who acted.
- Do not translate or paraphrase technical terms to save length; a wrong term costs more than the words it saved.

## Output

- The shortened text first, no preface.
- A line with the measured count against the target.
- A short list of what was removed by category (examples, background, a section), so the user can restore something in exchange for cutting elsewhere.
- If the target could not be met without losing a key point, say so and offer the choice instead of dropping the point.
