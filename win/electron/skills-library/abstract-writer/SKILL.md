---
name: abstract-writer
description: Writes a standalone abstract for a paper, thesis, report or proposal that states the question, method, main results and meaning in the source's own terms, within the venue's word limit. Use when the user asks for an abstract, a paper summary for submission, or an executive abstract of a report.
---

# Abstract writer

## Goal

A reader who sees only the abstract learns what was asked, how, what was found and why it matters. A good result uses only claims and numbers the source contains, follows the venue's format and stays under its limit.

## When to use

- A paper, thesis, report or proposal needs an abstract.
- An existing abstract describes the document instead of reporting it.
- For a general summary of any text, use `use_skill` with `summarizer`.
- For tightening an abstract that runs over, use `use_skill` with `shorten-text`.

## Steps

1. Read the full source with `read_file`. Read the results and conclusion sections before the introduction, because the abstract must match what was found, not what was hoped.
2. Learn the format. Ask with `ask_user` for the venue or guideline, the word limit, whether it must be structured (background, methods, results, conclusions) and whether keywords are required. If the venue is named, check its current author instructions with `read_url` or `search_web`, since limits change.
3. Extract five items in your own notes, each with its location in the source:
   - the problem or question and why it matters;
   - the approach or data (design, sample, dataset, scope);
   - the principal results, with the key numbers;
   - the conclusion the authors draw;
   - the limit or implication they state.
4. Draft in the order above, present tense for what the paper does and claims, past tense for what was done and found, unless the venue's convention differs. Give the numbers that carry the result, not all of them.
5. Cut anything that is not in the source. Do not add a claim of significance the authors did not make. Do not add citations unless the venue's abstracts allow them.
6. Define an abbreviation only if it is used again, and avoid ones the field does not know. Do not refer to "this paper shows" more than once.
7. Count words with `run_command` against the limit. Trim background first, then method detail; keep results.
8. Check every number and name against the source line by line. If the source gives a figure in two places and they differ, flag it for the author.
9. If keywords are required, choose terms a searcher would use that appear in the text, not new ones.

## Gotchas

- The commonest failure is an abstract that describes the paper ("this paper discusses X") with no finding in it. The reader needs the finding.
- Writing the abstract from the introduction's promise rather than the results section produces claims the paper later weakens.
- Rounded or restated numbers drift. Copy them exactly, with their units and the sample size they came from.
- Causal wording ("leads to") for a correlational result is an overclaim. Use the source's own verbs.
- Structured abstracts have fixed headings in some fields. Using the wrong heading set can cause a desk rejection.
- An abstract is read apart from the paper, so a figure or section reference in it is meaningless.

## Output

- The abstract, within the limit, with the headings if structured.
- Keywords, if requested.
- The word count against the limit.
- A list of source passages you leaned on for each key number, and any inconsistency in the source for the author to settle.
