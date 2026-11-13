---
name: fact-sheet
description: Condenses verified facts on a topic into a one-page sheet where every figure has a source and a date, split into confirmed facts, estimates and open questions. Use when the user asks for a fact sheet, a one-pager of key facts, or quick facts they can hand to others.
---

# Fact sheet

## Goal

Produce a page someone can scan in two minutes and trust. It holds only what has been checked, each fact has a link and a year, and things that are estimates or disputed are marked as such.

## When to use

- The user needs a handout, briefing note, press backgrounder or reference card.
- The user already researched a topic and wants the facts distilled.
- For a long argued report, use `use_skill` with `deep-research`. To test one disputed statement, use `fact-check`.

## Steps

1. **Define reader and purpose.** Use `ask_user` for who reads it, what they need to do with it and the limit (one page, 300 words). The reader decides which facts matter.
2. **List the questions the reader will ask.** Typically what is it, how big, who is involved, when did it start, what is the current status and what is contested. Use these as the sheet's skeleton.
3. **Find each fact.** Use `search_web` and `read_url` for the issuing body: statistics office, regulator, company filing, official report. Open the page and read the line, not the snippet.
4. **Record the fact card.** For each: the statement, the number with unit, the date it refers to, the source and the date accessed.
5. **Verify.** For every number, find a second source or the primary data. If only one source exists, mark it single-source.
6. **Handle changes.** Prefer the latest release. If there is a newer one expected, say when.
7. **Sort.** Group facts as confirmed, estimated (with method named) and disputed (with both positions).
8. **Cut.** Keep the facts that serve the stated purpose. Drop trivia, even if true.
9. **Lay out.** A title, a two-line summary, the grouped facts as short lines with a source marker, and a numbered source list. Save with `create_file` if the user wants a file.
10. **Test with a reader.** Ask yourself what a skeptical reader would challenge first, and confirm that line has its source on the page.
11. **Plan the update.** Add a recheck date next to any figure that a scheduled release will replace.

## Gotchas

- Numbers without a year age badly. Always attach the reference date, since the publication date can be years later.
- Rounded figures from different sources do not add up. Use one source per related set and say which.
- A fact sheet invites copying. Phrase the claims exactly as the source supports, with no stronger verbs.
- Units trip readers: billions, long and short scales, per-capita against totals. Spell the unit out.
- Resist the extra fact. A page that overflows gets skimmed, and the key line gets lost.
- Mark the sheet with its own date so readers know when to recheck.
- Charts on a one-pager need the same sourcing as text. Skip a chart when you cannot label its source.
- Contested facts need both sides named. Do not choose a side silently.

## Output

A single page: title, date, two-line summary, grouped facts each ending in a bracketed source number, a short "not yet known" list and the numbered sources with access dates. No narrative paragraphs.
