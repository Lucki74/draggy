---
name: appointment-prep
description: Prepares a list of questions, papers and logistics for an appointment such as a bank, school or service visit, and structures the notes afterwards. Use when the user asks to prepare for an appointment, what to bring to a meeting, or to write down questions for a visit.
---

# Appointment prep

## Goal

Help the user arrive ready: clear about what they want from the visit, with the right papers in hand, and leave with a written record of what was said and what comes next.

## When to use

- A visit with a bank, school, landlord, tradesperson, council office or similar is booked.
- The user tends to forget questions once in the room.
- Sorting the papers for later is `use_skill` with `document-organizer`.

## Steps

1. Ask with `ask_user` who the appointment is with, the date and time, the place or link, and what the user wants as the outcome.
2. Ask what happened before: earlier letters, reference numbers, names of people already spoken to, and any deadline.
3. Check the organisation's page with `read_url` for what to bring, fees, and the way to get there or join online. Note the source.
4. List the papers to bring, such as ID, reference numbers, earlier letters, contracts, bills or photos, and mark which need originals.
5. Write the user's goal in one sentence, and a minimum acceptable result.
6. Write the questions in order of importance, with the top three marked. Phrase them so they cannot be answered with a vague yes.
7. Add questions about next steps: who does what, by when, and how the user will be told.
8. Plan the logistics: route, travel time with a buffer, parking or login test, and a phone number to call if late.
9. Prepare a short summary of the situation the user can say in half a minute.
10. Plan how to take notes: date, names and roles, key statements, promises with dates, and the next contact.
11. After the visit, help the user write a short confirmation message that restates what was agreed, if the user wants to send it.
12. Save the prep sheet and notes with `create_file`, and list any deadline clearly so the user can add it to a calendar.

## Gotchas

- Arriving without the reference number.
- Not noting the name of the person seen.
- Forgetting to write the outcome down.
- Leaving the main question for the last minute of the slot.
- Agreeing to something under pressure with no time to read it.
- Relying on a verbal promise with no written follow-up.
- Treating the prep as medical, legal or tax advice. For those, the user relies on the professional in the room.
- Bringing only copies when originals are required.

## Output

A one-page prep sheet with goal, papers, ranked questions and logistics, and a notes template for after the visit.
