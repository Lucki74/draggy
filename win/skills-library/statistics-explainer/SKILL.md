---
name: statistics-explainer
description: Explains a statistical idea or result to a non-specialist in plain words with a concrete example and an honest statement of its limits. Use when the user asks what a p-value, confidence interval, standard deviation, correlation or similar term means, or how to read a result.
---

# Statistics explainer

## Goal

Leave the reader with a correct, usable understanding of one concept or result, in their own context. A good explanation starts from what the reader already knows, gives a definition that is accurate and short, shows it on a small example with numbers, and says what people usually get wrong.

## When to use

- A reader meets a term in a report and does not know what it means.
- The user needs to explain a result to a colleague, client or manager.
- A number in a dashboard is being misread.
- For reading an experiment result in full, use `use_skill` with `ab-test-reading`.
- For interpreting a fitted model, use `use_skill` with `regression-basics`.

## Steps

1. Find out what the reader needs it for and how much maths they have. Use `ask_user` for one line on each: the decision they face and their background. If the user pasted a result, read it with `read_file` or from the message and take the numbers from it.
2. State the concept in one plain sentence without jargon. Check it for accuracy against how the term is really defined. If you are unsure of a detail, look it up with `search_web` or `read_url` on a reliable statistics reference before answering.
3. Give the intuition with an everyday picture, then tie it to the reader's own numbers. A p-value, for example, is how surprising the data would be if there were no real effect, and not the chance that the effect is real.
4. Work a small example with actual numbers. Use `run_command` to simulate it if a simulation makes it clearer, such as drawing many samples to show how a sample mean varies, and report the figures you got.
5. Say how to read it: what a large or small value means, what range is typical, and how it relates to the size of the sample.
6. Name the two or three most common misreadings and correct them in one line each.
7. Give the limit: what the number cannot tell you (cause, importance, future behaviour), and what to look at next to cover the gap.
8. If the user wants to explain it to others, offer a two-sentence version for a non-technical reader and one chart idea that shows the concept.
9. Check the explanation by asking yourself whether a careful statistician would agree with every sentence, and remove any claim that is only roughly true.

## Gotchas

- The popular reading of a 95 percent confidence interval ("a 95 percent chance the true value is in here") is wrong for the standard method. The correct statement concerns the long-run behaviour of the procedure, and a simpler honest version is "a range of values consistent with the data".
- A p-value is not the probability that the hypothesis is true, nor the size of the effect.
- "Statistically significant" says nothing about importance. A tiny effect can be significant in a large sample.
- Correlation of 0.3 does not mean 30 percent. The share of variance is the square, about 9 percent.
- Average without spread misleads. Pair every mean with a measure of variation or a distribution.
- Analogies carry over only part of a concept. Say where the picture stops matching the maths.
- A single example can mislead if it is atypical. Try one more case with different numbers.
- Rounding hides small p-values or wide intervals. Quote the figures with enough digits to be checked.
- Jargon in the explanation defeats its purpose. Reread it as someone who has never taken a statistics course.

## Output

- A one-sentence definition, an intuition, and a worked example with numbers.
- How to read it and the common mistakes.
- The limit of what it tells you, and a short version for a non-specialist if requested.
- A suggested follow-up question the reader can ask the analyst.
- The source consulted for the definition, if one was looked up.
