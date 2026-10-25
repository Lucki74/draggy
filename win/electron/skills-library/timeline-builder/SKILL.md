---
name: timeline-builder
description: Builds a dated timeline of events from several sources, orders them by when they happened rather than when they were reported, and flags dates where sources conflict. Use when the user asks for a timeline, a chronology, or what happened in what order.
---

# Timeline builder

## Goal

Give an ordered list of events where each entry has a date, a one-line description and a source. Conflicts and gaps are shown in the list, not hidden. The user can read the whole story at a glance and check any line.

## When to use

- The user wants the sequence of an incident, project, case, product history or career.
- Sources give events in a jumbled order and the user needs them straightened.
- For explaining why something happened, use `use_skill` with `deep-research`. For checking one date or claim, use `fact-check`.

## Steps

1. **Set the frame.** Agree on subject, start, end and level of detail. Use `ask_user` if the user wants key events only or every step.
2. **Gather sources.** Use `search_web` for official records, contemporary reports and later accounts. Prefer sources written near the time of the event. If the user supplied files, read them with `read_file`.
3. **Open each source.** Use `read_url` and extract every dated event with the exact date as written, plus the source's own words for it.
4. **Normalise dates.** Convert to one format, year-month-day. Keep the original string in a note when it is vague, such as "early March" or "Q3".
5. **Separate event date from report date.** An article from Tuesday about Sunday's event goes under Sunday. Check the wording for "on", "last week", "yesterday".
6. **Handle time zones.** For events within a day or across regions, record the zone. If unknown, say so.
7. **Merge and sort.** Combine duplicate events across sources into one line with several citations. Sort by date.
8. **Mark conflicts and gaps.** Where sources give different dates, list both with sources and say which looks stronger and why. Mark spans with no information.
9. **Check the order makes sense.** Cause should not follow effect. Re-open the source if a sequence looks impossible.
10. **Add context markers.** Insert a few external anchors (a law passing, a release, an election) only when a source ties them to the story.
11. **Offer a view.** Ask whether the user wants it as a list, a table or a file via `create_file`.

## Gotchas

- Relative dates in old articles lose meaning. Resolve them against the publication date, not today.
- Date formats flip between day-month and month-day. A date like 04/05 needs the source's locale to read.
- Later accounts compress events. A memoir or retrospective is useful for context, weak for exact dates.
- Wikis and summaries copy each other, so agreement between them is not confirmation. Count independent origins.
- A scheduled date is not an event date. Plans, announcements and deadlines are separate from what occurred.
- Do not fill a gap with a plausible guess. Show the gap.
- Court and agency records use filing, decision and effective dates. Label which one each line uses.
- Leap days and year boundaries trip hand arithmetic. Use `run_code` to compute spans between dates.

## Output

A dated list, oldest first, one line per event: date, event, source link. Conflicts in a separate short list below. Offer a saved copy with `create_file` if the list has more than 20 entries.
