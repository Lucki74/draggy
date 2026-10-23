---
name: plain-language-rewrite
description: Rewrites dense, technical or bureaucratic text so a general reader can understand it and act, keeping every condition and fact, and checks the result with a readability measure and a read-through. Use when the user asks to put something in plain English, simplify for a general audience, or make text easier to read.
---

# Plain language rewrite

## Goal

The intended reader understands what is said and knows what to do. A good result keeps every fact, condition and exception, uses short common words where they are accurate, puts the reader's action first, and is tested on structure and readability as well as vocabulary.

## When to use

- Instructions, notices, policies, forms, reports or help pages that readers misread.
- Technical content meant for non-specialists.
- For changing the mood or formality only, use `use_skill` with `tone-rewriter`.
- For a short version, use `use_skill` with `summarizer`.

## Steps

1. Read the source with `read_file`. Ask with `ask_user` who the readers are, what they already know, what they must do after reading and whether any wording is fixed (a legal term or a product name that cannot change).
2. List the facts to keep: each fact, condition, deadline, amount and exception. Treat the list as a checklist for step 8.
3. Restructure before rewording. Put the main message and the reader's action first. Group related points under headings that name the question the reader has. Move background after the action.
4. Rewrite sentences: one idea each, subject near the verb, active voice where the actor is known, "you" for the reader when the genre allows, and "must", "may" and "can" used for what they mean. Turn nouns made from verbs back into verbs.
5. Replace difficult words with common ones only where meaning survives. Keep necessary terms and explain each once, at first use. Do not replace a precise term by a vague phrase.
6. Use lists for steps and for parallel conditions. Keep tables for data. Define abbreviations on first use or avoid them.
7. Measure with `run_code`: average sentence length and word length, and a standard readability formula if you write it. Use numbers as a hint, never as the goal. Different languages use different formulas; say which you used.
8. Compare with the fact list. Every fact, condition, number and exception must still be present and mean the same. Check negatives and "unless" clauses with particular care.
9. Read the result as the intended reader would, from the first line. Ask the user to test it on one real reader if the stakes are high. Save with `create_file` if wanted.
10. Add concrete examples where a rule is abstract: a sample date, an amount, a case that shows the rule at work.
11. For forms and notices, put the deadline and the consequence of missing it near the top.

## Gotchas

- Losing a condition is the biggest risk. "You may apply if you have lived here a year" and "you can apply if you live here" are different rules. Keep the condition.
- Shorter words do not make a text plain if the structure is tangled. Most of the work is order and sentence design.
- Readability scores reward short sentences and short words, which can be gamed and can hide missing content. Judge by a reader, not a score.
- Plain language is for the reader's benefit, not a way to remove precision from content that needs it. Keep the exact term for the reference version.
- Do not condescend. Explaining basics to an informed reader insults them. Match the stated audience.
- Rules that vary by law or policy must be checked against the source, not paraphrased from memory.
- Text that has legal force, such as terms, contracts or regulations, must keep its authorised wording. Offer the plain version as a companion and tell the user it needs review by whoever owns the text.
- Idioms and metaphors confuse non-native readers. Prefer literal wording for a mixed audience.
- Numbers and dates should use the format of the readers' region, and be written the same way throughout.
- Long noun stacks ("customer account access request form") hide relations. Break them with small words.
- A glossary helps only if the terms in it appear in the text. Do not add one for show.

## Output

- The rewritten text.
- Before and after readability numbers, with the formula named.
- The fact checklist with each item confirmed, and any term you kept on purpose with its explanation.
- Items where the source was ambiguous, left for the author to settle.
