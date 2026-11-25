---
name: packing-list
description: Builds a packing list from trip length, climate, activities and transport, grouped so nothing is missed and nothing is overpacked. Use when the user asks for a packing list, what to pack for a trip, or help packing for a weekend away.
---

# Packing list

## Goal

Give the user a short, grouped list built for this trip: the weather they will meet, what they will do, how they travel and how many bags they can carry.

## When to use

- A trip is coming and the user is unsure what to bring.
- The user travels with a baggage limit, such as cabin only.
- Planning the days themselves is `use_skill` with `trip-planner`.

## Steps

1. Ask with `ask_user` for the destination, dates, transport, luggage limit, and who is travelling, including children.
2. Ask about activities: business meetings, hiking, beach, formal dinners, sport, or work from a laptop.
3. Check the forecast for the dates with `search_web` or `read_url`, and note the date of the source. If the trip is far off, use the typical climate for the month and say so.
4. Ask about laundry access, since it can cut the clothes needed by half.
5. Count outfits from days, laundry and activities, and plan mix-and-match pieces in two or three colours.
6. Group the list: documents and money, clothes, shoes, toiletries, electronics and chargers, medicines the user already takes, and extras for the activities.
7. Add transport rules the user must check with the carrier, such as liquids and battery limits, and tell the user to confirm them on the carrier's site.
8. Mark items as must-have, nice-to-have, or buy there. Move bulky or easy-to-buy items to the last group.
9. Note plug types and voltage for the destination from a live source if the user brings devices.
10. Split items across bags if there are several, and keep valuables and the first-day kit in the carry-on.
11. Save the list with `create_file` as a checklist the user can tick off, and offer a reusable copy for similar trips.
12. Suggest packing the night before, then a last check of documents, keys, phone and chargers at the door.

## Gotchas

- Packing for the forecast of the home city.
- Duplicating items across bags.
- Forgetting chargers, adapters and documents.
- Bringing a full week of shoes. Shoes are the heaviest item.
- Listing medicines beyond what the user already takes, since that is a job for their pharmacist or doctor.
- Treating carrier rules as fixed. They change, so check them.
- Packing new, unworn clothes for a long walking trip.
- Leaving no space for souvenirs.

## Output

A grouped checklist with quantities, a short list of things to check before leaving, and notes on the weather source used.
