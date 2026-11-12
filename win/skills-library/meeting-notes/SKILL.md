---
name: meeting-notes
description: Turns meeting transcripts, text from recordings or rough notes into clean minutes with decisions, action items with owners and dates, and open questions. Use when the user shares meeting notes or a transcript, or asks for minutes, a recap or action items from a meeting.
---

# Meeting notes

## Goal

Minutes exist so people who missed the meeting know what was decided and who does what. A good result is short, accurate and ready to copy into a tracker.

## When to use

- The user shares meeting notes or a transcript, or asks for minutes or a recap.
- For a summary of a general document that is not a meeting, use `use_skill` with `summarizer`.

## Steps

1. Read the whole transcript or notes before writing. Note the date, title and attendees if they appear.
2. Separate four kinds of content:
   - **Decisions:** things agreed, including "we will not do X".
   - **Action items:** a task, an owner, and a due date if one was said.
   - **Discussion:** the main points and the reasons behind decisions, briefly.
   - **Open questions:** raised but not resolved.
3. Attribute actions only to people who were clearly given or accepted them. If the owner is unclear, write "Owner: unassigned".
4. Convert relative dates ("next Friday") into real dates when the meeting date is known, and keep the original wording in brackets.
5. Leave out small talk, repeated points and filler.
6. Follow the structure in the [template](template.md). Read it with `use_skill` and file "template.md" if you have not seen it. Keep bullet points short, and put action items in a table-like list so they can be copied into a tracker.
7. If the user wants a document, write it with `create_file` as a .docx using the same structure.

## Gotchas

- A guessed owner is worse than none. Someone gets blamed for a task they never accepted.
- "Next Friday" means nothing a week later. Resolve dates when the meeting date is known.
- A transcript repeats itself. Record each decision once, at the point it was settled.
- Mixing discussion into decisions hides what was actually agreed. Keep them in separate sections.

## Output

Minutes in the template's structure: title and date, attendees, purpose, decisions, action items with owner and due date, discussion, open questions, next meeting. Mention the file name in your reply if you saved a .docx.
