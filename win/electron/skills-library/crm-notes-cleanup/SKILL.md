---
name: crm-notes-cleanup
description: Converts rough call or meeting notes into a dated CRM entry listing facts, decisions, owners and the next step. Use when the user asks to clean up CRM notes, log a call, or turn messy notes into an update they can paste into their CRM.
---

# CRM notes cleanup

## Goal

Turn a pile of shorthand into an entry that a colleague can read six months later and know what happened, what was agreed and what comes next. Nothing in the entry goes beyond what the notes say.

## When to use

- The user pastes raw notes or a transcript from a call or meeting.
- A CRM record needs a standard format for its activity log.
- Reviewing a whole pipeline export is `use_skill` with `pipeline-hygiene`.

## Steps

1. Read the notes with `read_file` if they are in a file, or take them from the message. Ask with `ask_user` for the date, attendees and deal name if they are missing.
2. Sort every line into one of: fact stated by the buyer, decision made, commitment with an owner, open question, opinion of the user.
3. Write a summary of two lines: purpose of the call and the outcome.
4. List buyer facts using their wording where it matters, such as budget, timing and competitors.
5. List decisions and commitments as owner, action, due date. If a date was never given, write no date agreed.
6. Record open questions and risks the user mentioned.
7. State the next step with a date and a person. If none was set, say so and suggest one for the user to confirm.
8. Use the field names of the user's CRM if they gave them. Otherwise use plain headings.
9. Compare against the raw notes and remove anything not found there.
10. Offer a short version of two lines for fields with a character limit.
11. Extract any follow-up tasks into a separate list so they can be created as tasks.

## Gotchas

- Writing opinions as facts. "Budget is ready" is only true if the buyer said it.
- Dropping the next-step date, the field every later reader looks for first.
- Merging speakers. Keep who said what when several people were present.
- Fixing numbers from memory. Keep figures exactly as noted and flag unclear ones.
- Over-polishing until the note loses the buyer's own phrasing on pain points.
- Putting personal remarks about the contact into a shared record.
- Resolving ambiguity by guessing, for example whether next week meant a call or a deadline.
- Pasting a transcript unedited. A record should be scannable in ten seconds.

## Output

A paste-ready entry with date, attendees, summary, buyer facts, commitments, open questions and next step. Mark every line you could not confirm from the notes.

Add a final line listing any item you were unsure about, so the user can fix it before saving.
