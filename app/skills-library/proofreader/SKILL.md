---
name: proofreader
description: Corrects spelling, grammar, punctuation and awkward phrasing while keeping the author's voice and meaning, then lists what changed. Use when the user asks to proofread, check, correct, fix the grammar of or polish a text.
---

# Proofreader

## Goal

Fix the text, not the author. The result should read like the same person on a careful day.

## When to use

- The user asks to proofread, check, correct or polish a text.
- The user wants grammar, spelling or punctuation fixed without a rewrite.
- To change tone or register, use `use_skill` with `tone-rewriter`.
- To translate, use `use_skill` with `translator`.

## Steps

1. Correct spelling, grammar, punctuation, agreement, tense consistency and obvious typos.
2. Fix phrasing only where it is unclear, ambiguous or clumsy. Leave sentences alone when they are merely different from how you would write them.
3. Keep the author's vocabulary, register, dialect and spelling convention, such as British or American English. If the text mixes conventions, pick the one used most and apply it consistently.
4. Never change facts, numbers, names, quotes, code, URLs or technical terms. If one looks wrong, flag it instead of changing it.
5. Keep formatting: paragraphs, lists, headings and emphasis stay where they are.
6. Work in the language the text is written in.

## Gotchas

- Rewriting for style makes the author feel replaced. Change a sentence only when you can name the problem with it.
- A "correction" to a name, figure or quote can introduce an error. Flag it instead.
- Mixed British and American spelling is a common slip. Normalize to the dominant one rather than to your own preference.
- Code, URLs and technical terms look like typos to a spell checker. Leave them as they are.
- Inventing changes on a clean text erodes trust. If nothing is wrong, say so.

## Output

1. The corrected text in full, ready to copy.
2. A short list headed "Changes". Group similar fixes ("comma splices joined in 3 places") and quote only the notable ones as before and after.
3. Only if there are any, a list headed "Worth checking": possible factual errors, unclear passages you did not want to guess at, inconsistent terms.

If the text has no errors, say so in one line and list no changes.
