---
name: style-guide-enforcer
description: Checks a document against a named or supplied style guide, finds each deviation with its rule reference, and applies or proposes the fix without changing meaning. Use when the user asks to check text against a style guide, enforce house style, or asks whether something follows AP, Chicago or a company guide.
---

# Style guide enforcer

## Goal

Make a document consistent with one stated set of rules. A good result applies only rules the guide actually contains, cites the rule for each change, separates required rules from preferences, and leaves content untouched.

## When to use

- A team has a style guide and a draft that may not follow it.
- Several authors' sections need to read as one voice.
- The user asks if a text meets a named guide.
- For typos and grammar alone, use `use_skill` with `proofreader`.
- For sentence clarity, use `use_skill` with `clarity-edit`.

## Steps

1. Identify the guide. Ask with `ask_user` which one applies, its edition, and whether there is a company addendum. If the user supplies a file, `read_file` it fully. For a published guide, do not rely on memory: find the rule text with `search_web` or `read_url`, or ask the user to paste the relevant sections.
2. Extract the rules that matter for this document type into a working checklist: capitalisation, headings, numbers and dates, punctuation, abbreviations, names and titles, spelling variant, citations, terminology, tone. Note which rules are mandatory and which are advice.
3. Read the target text with `read_file`. For a folder of documents, use `search_files` for recurring terms and patterns (a banned word, a date format) to find every instance.
4. Scan for deviations section by section. For each, record location, the text, the rule, and the corrected form. Group repeats of the same deviation into one line with a count.
5. Check terminology consistency across the document: one spelling of each product name, one form of each term, hyphenation applied the same way each time. Build a short term list as you go.
6. Judge ambiguous cases. Where the guide allows two options, accept the one the document already uses consistently. Where the guide is silent, do not invent a rule; mention it as a question.
7. Apply the fixes with `edit_file` when asked to edit, one rule at a time so the changes can be reviewed. Otherwise return a list of proposals.
8. Re-scan after editing for new problems, such as a heading changed to sentence case that is now inconsistent with the table of contents.
9. Do not touch quotations, code blocks, legal wording, URLs or titles of works unless the guide says how. Preserve them as written.
10. Summarise the three most frequent deviations, so the author can fix the habit behind the instances.
11. If the user has no guide, offer to derive a short one from the document's dominant choices, and label it as inferred.

## Gotchas

- Guessing a rule from memory and presenting it as the guide's is the worst error. Cite the rule text or say you could not find it.
- Style guides disagree with one another (serial commas, title case, number thresholds). Never mix rules from two guides.
- A mechanical find and replace changes quotations, names and code. Review each hit in context.
- Rules often have exceptions for headings, tables and captions. Read the exception before applying the rule to them.
- Fixing style can change meaning, as with capitalisation that separates a title from a common noun. Check meaning when you change case or hyphenation.
- Editions differ. A rule from an older edition may now be reversed. Ask for the edition.
- Spelling variants (colour and color) are style rules and a language setting. Check which one the guide and the audience want.
- Automated linters catch patterns, not intent. Treat their output as candidates and read each one.
- A guide's rules about inclusive or sensitive terms may be updated often. Check the current version before citing.
- Do not rewrite for voice or flow under the banner of style. That is a separate request.
- Tables and code samples follow different conventions from running text. Apply the rules for the right element.

## Output

- A table of deviations: location, issue, rule reference, fix, and whether the rule is required or preferred.
- The edited text or file if edits were requested.
- The term list built during the check.
- Open questions where the guide is silent, and rules you could not verify.
