---
name: meeting-agenda
description: Drafts a meeting agenda with a stated purpose, timed items, an owner for each item and the decision or output each one needs. Use when the user asks to write an agenda, plan a meeting or sync, or decide whether a meeting is needed at all.
---

# Meeting agenda

## Goal

An agenda that people can read in under a minute and that lets the meeting end on time with decisions made. Each item has a reason to be in the room.

## When to use

- The user is organizing a meeting, workshop, one-on-one or sync and wants the agenda written.
- The user asks if a meeting is necessary.
- For writing up what happened afterwards, use `use_skill` with `meeting-notes`.
- For a team looking back on a period of work, use `use_skill` with `retrospective`.
- The user runs a recurring one-on-one or team sync that has drifted and needs a reset.

## Steps

1. Ask with `ask_user` for the purpose in one sentence, the attendees, the length, and anything that must be decided. If the user cannot state a purpose, say so and ask what would be different after the meeting.
2. Test whether a meeting is needed. If the purpose is only sharing information, suggest a written update (see `use_skill` with `status-update`) and keep the meeting for questions.
3. List candidate topics. For each, mark its type: decide, discuss, inform, or brainstorm. Move pure inform items to a pre-read.
4. Set the order. Put the decisions first while people are fresh, discussion next, quick information last. Put a topic early if people need to leave before the end.
5. Assign time. Total the minutes and compare with the length. Leave 10 percent unscheduled. If the total is over, cut topics instead of squeezing every slot.
6. For each item write the desired outcome in one line ("Choose vendor A or B") and the person who leads it.
7. List the pre-work: documents to read, numbers to bring, and who prepares them. Put the links in the agenda.
8. Check the attendee list against the items. Anyone with no item to speak to or decide is optional. Mark them so.
9. Add a closing slot of five minutes for actions: who does what by when.
10. Read it back against the Goal. The purpose line, times and outcomes should all be present.

## Gotchas

- A topic without a desired outcome becomes a long chat. Reject topics that read as nouns only.
- Times that add up to more than the slot are a plan to overrun. Do the arithmetic.
- Invite lists grow by habit. Each additional person adds cost across the whole meeting.
- Putting the hardest item last means it gets 3 minutes at the end. Decide early.
- Do not bury the pre-read in the invite. People skip it unless the agenda says what to read and for which item.
- A recurring meeting needs the agenda refreshed each time, not copied.
- Remote meetings need a plan for who speaks when and where notes go. Add a line for it.

## Output

Send the agenda at least a day ahead when the meeting has pre-work. Say so in your reply.

The purpose line, date and length, then a table with Time, Topic, Type, Lead and Outcome. Below it: Pre-work with links, and Actions slot. About 15 lines. Offer to save with `create_file` as markdown.
