---
name: one-pager
description: Condenses a project, product, proposal or report into a single page that a busy reader can act on, leading with the point and the ask and cutting everything else. Use when the user asks for a one-pager, an executive brief, or a one-page summary of a longer document or plan.
---

# One-pager

## Goal

One page that gets a decision or understanding without the reader opening anything else. The main point is in the first lines, the evidence is selective, and the ask is explicit.

## When to use

- The user has a long plan, report or idea and needs a short version for leaders, partners or customers.
- The user is sending something ahead of a meeting.
- For a full recommendation with options, use `use_skill` with `strategy-memo`.
- For a slide structure, use `use_skill` with `pitch-deck-outline`.
- For summarizing a document without a call to action, use `use_skill` with `document-qa`.
- The user needs a leave-behind after a meeting, a grant summary or a product sheet.

## Steps

1. Ask with `ask_user` who will read it, what they should do after reading and how much they know already. Read the source with `read_file`. If the source is long, work through it in sections.
2. Write the one-sentence point: what this is and why it matters, with the ask. Test it by reading it aloud. If it needs two breaths, shorten.
3. Choose the sections the reader needs and drop the rest. A common set: Problem or opportunity, Proposal, Why it works (evidence), Cost and timeline, Risks, Ask. Rename to fit the reader's vocabulary.
4. Pull evidence. Keep the two or three facts that carry the argument, each with its source or owner. Verify each number against the source file. If a figure is missing or unclear, ask the user rather than rounding.
5. State the ask exactly: approve X, give Y by date, meet on a week. Put it in the top third and repeat in the last line.
6. Compress. Cut background the reader already knows, qualifiers, process history and any detail that does not change the decision. Use short sentences and active verbs. One idea per bullet.
7. Lay it out for scanning: a title, a summary line in bold, headings, short bullets, one small table if comparing. Leave white space. Keep to 350 words or fewer for text-only pages.
8. Cold read. Ask the user to imagine reading it in 60 seconds: what do they remember, and what would they do? Fix what does not land.
9. Add contact and date. Mention where the longer document lives for readers who want it.

## Gotchas

- Shrinking the font to fit more is a failure of editing. Cut content.
- Leading with background hides the point. Put the conclusion and ask first.
- A table of ten numbers does not persuade. Pick the two that matter.
- Summaries drift from the source. Recheck each claim, name and date against it.
- Jargon from the author's team confuses outsiders. Spell out or replace.
- A one-pager for several audiences serves none. Make a version for each.
- Names and titles of the reader and the sender must be right. Check spellings against the source.

## Output

The page text in markdown with a title, the point in bold, short sections and the ask. A one-line note on what was cut and where the full detail lives. Offer `create_file` for a .md or .docx file.
