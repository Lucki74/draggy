---
name: move-checklist
description: Builds a dated moving checklist covering notices, address changes, packing, utilities and the first week in the new place. Use when the user says they are moving, asks for a moving checklist, or wants to know what to do when they move.
---

# Move checklist

## Goal

Turn a move into a dated list working back from moving day, so notices, bookings and address changes happen on time and the first night in the new place is comfortable.

## When to use

- A move date is set or nearly set.
- The user is moving within a city, across the country or abroad.
- Setting a budget for the move is `use_skill` with `budget-planner`.

## Steps

1. Ask with `ask_user` for the moving date, old and new addresses, rented or owned, household size, and whether the user hires movers or does it alone.
2. Ask about the notice period in the lease or sale terms. Tell the user to read the contract itself, and send legal questions to a professional.
3. Count back from moving day and create milestones: eight weeks, four weeks, two weeks, one week, moving day, and the first week after.
4. Eight weeks out: declutter, decide what to sell or donate, get quotes from movers or van hire, and check insurance for transit.
5. Four weeks out: give notice where needed, book the date for movers, order boxes, and start packing rarely used rooms.
6. Make an address change list: bank, employer, tax office, insurers, doctors, schools, subscriptions, delivery apps and the postal forwarding service. Check each body's own process on its official site.
7. Arrange utilities: final meter readings at the old place, start dates at the new one, internet install, and any local registration. Look up local rules with `search_web`.
8. Two weeks out: confirm movers, plan parking or lift access, and pack by room with labels showing the room and priority.
9. Pack an essentials box: documents, chargers, bedding, toiletries, a basic tool kit, cleaning supplies and snacks.
10. Moving day: do a walk-through with photos of the old place, record meter readings, collect keys, and check the new place before the movers leave.
11. First week: unpack the kitchen and bedroom first, update remaining addresses, and test smoke alarms and the fuse box.
12. Save the checklist with `create_file` with due dates, and note which tasks depend on others.

## Gotchas

- Leaving utilities and mail to the last week.
- Packing essentials in the first boxes.
- Assuming every office accepts one address change.
- Not photographing the old place at hand-over.
- Skipping transit insurance quotes.
- Forgetting parking permits or lift bookings.
- Throwing away papers that proof of address may need.
- Trusting a mover's verbal quote with nothing in writing.

## Output

A dated checklist by milestone, an address change list with status, a utilities table and an essentials box list.
