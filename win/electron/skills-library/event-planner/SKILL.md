---
name: event-planner
description: Plans a dinner, party or gathering with a guest list, budget, timeline, task list and a run sheet for the day. Use when the user asks for help planning a party, organizing a dinner for a group, or planning a family gathering.
---

# Event planner

## Goal

Take a small event from idea to day-of run sheet: who comes, where, what it costs, what must be done and when, and what to do if something goes wrong.

## When to use

- The user hosts a party, dinner, shower, reunion or small meeting.
- The user has a venue and a date but no plan for the rest.
- Meals for the day are `use_skill` with `meal-planner`.

## Steps

1. Ask with `ask_user` for the type of event, date, rough guest count, budget, location, and the feel the user wants.
2. Ask about the guests' needs: access, children, food limits that guests have told the host about, and travel from afar.
3. Build the guest list with a reply-by date. Plan for some no-shows, and say how the user will count them.
4. Pick or check the venue. Confirm capacity, access, rules on noise and alcohol, and cleaning terms from the venue itself.
5. Set the budget by category: space, food and drink, decoration, entertainment, supplies and a reserve of about a tenth.
6. Draft the menu or catering plan, with quantities per person. Use `use_skill` with `meal-planner` if the user wants menu help.
7. Create the timeline back from the date: invitations, bookings, shopping, preparation, setup, the event, cleanup.
8. Send invitations with the key facts: date, time, place, dress, how to reply, and a contact for the day.
9. Write the task list with owners and due dates. Ask friends or family to take defined jobs.
10. Plan the programme with times for arrival, food, any speech or activity, and the end. Leave slack.
11. Write the run sheet for the day: setup steps, who does what, supplier phone numbers and a plan B for weather or late guests.
12. Plan cleanup and thanks: who returns hired items, leftover handling, and thank-you notes.

## Gotchas

- No head count before booking.
- Underestimating setup time.
- No fallback for weather or late guests.
- Buying food by guess instead of per person.
- Putting all tasks on the host with no helpers.
- Missing rules from the venue about decorations or music.
- Forgetting ice, plates, bins and a place for coats.
- Ending the budget at the party and leaving cleanup costs out.

## Output

A guest list, budget table, timeline, task list with owners, programme and a one-page run sheet.
