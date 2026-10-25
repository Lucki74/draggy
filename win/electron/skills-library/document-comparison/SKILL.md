---
name: document-comparison
description: Compares two versions of a document and reports the meaningful changes, separated from formatting noise, with additions, deletions and moved passages listed. Use when the user asks what changed between two versions, to compare two documents, or to diff an old and a new report.
---

# Document comparison

## Goal

Tell the reader what actually changed between two documents so they can review the changes, not the whole text. A good result groups changes by section, separates content from formatting, and states clearly which file is the base.

## When to use

- Two drafts, two contract-free business documents, two reports or two exports of the same text.
- The user received a revised file with no tracked changes and wants a change list.
- For code diffs, use `git_diff` or `use_skill` with `code-review`.
- For checking two data tables rather than text, use `run_code` with a keyed comparison.

## Steps

1. Identify the pair. Use `list_directory` if names are ambiguous and `ask_user` to confirm which is the older base and which is the newer. Check modified dates as a hint, not a proof.
2. Convert both to comparable plain text. For docx or pdf, extract with `run_code` or `run_command`, keeping headings, list items and table cells on separate lines. Save both texts so the comparison can be rerun.
3. Normalise noise that is not content: whitespace runs, smart versus straight quotes, soft hyphens, page numbers, repeated headers, and automatic date or field values. Tell the user what you normalised.
4. Align by structure first. Split on headings and compare section by section, matching sections by title, so that an inserted chapter does not shift everything after it.
5. Diff inside each matched section at sentence level with `run_code` (a sequence matcher gives insert, delete and replace blocks). Then look for moved text: a deleted block that appears elsewhere almost unchanged is a move.
6. Classify each change: wording, number or date, added content, removed content, moved, structure, formatting only. Rank changes that touch numbers, names, dates, amounts and obligations first, because they carry the most risk.
7. Read ten of the reported changes back in the source files to make sure the diff is right.
8. Write the report with `create_file` if it is long: summary on top, then changes by section with the old text and new text in short quotes.
9. Offer the reader what they most likely need next.
   - A clean merged view of the new text with the changes marked, saved as its own file.
   - A list of questions for the author about changes that look unintended, such as a deleted caveat.
   - A check that numbers in the summary still agree with numbers in the body of the new version.
   - If there are three or more versions, a chain of pairwise comparisons rather than one comparison of first and last.
10. State clearly which version was treated as the base, in the first line of the report.

## Gotchas

- Comparing exports of the same content from different tools yields thousands of fake changes from spacing and quotes. Normalise before judging.
- Word-level diffs of heavily reworded paragraphs are unreadable. Show replaced paragraphs side by side instead.
- A changed number inside a table cell is easy to miss in a long diff. Run a separate numeric pass that lists every digit sequence that appears in one version only.
- Tracked changes already in a docx are part of the text. Decide whether to compare with them accepted, and say which.
- Do not describe the intent behind a change. Report what differs, and let the author explain why.
- Images, charts and embedded objects do not appear in a text diff. Say that they were not compared, and list how many each file has.

## Output

- A line on what was not compared: images, comments, metadata.
- A three-line summary: how many sections changed, the biggest change, and the changes in numbers or dates.
- Changes by section with old and new text, ranked by risk.
- What was normalised or ignored, and the path of the full report if saved.
