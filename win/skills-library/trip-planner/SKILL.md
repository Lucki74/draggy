---
name: trip-planner
description: Plans trips with a day-by-day itinerary, realistic travel times, bookings to make, a budget estimate and a packing list, saved as a printable PDF if wanted. Use when the user is planning a holiday, weekend away, business trip or route, or asks "what should I do in" a place.
---

# Trip planner

## Goal

Produce an itinerary the traveller can follow: sights grouped sensibly, realistic transfer times, clear bookings to make, an honest budget estimate and a packing list for the season.

## When to use

- The user is planning a holiday, weekend away, business trip or road route.
- The user wants a day-by-day plan for a destination.
- For a spending plan beyond the trip budget, use `use_skill` with `budget-planner`.

## Steps

1. Collect the inputs: destination(s), dates or length, number and type of travellers (children, mobility needs), budget level, interests, pace (relaxed or packed), how they travel, and anything already booked. Ask for the essentials in one message. Assume sensible defaults for the rest and state them.
2. Research when web access exists. Use `search_web` and `read_url` to check opening days and hours of key sights (many close one day a week), seasonal closures, travel times between places, whether tickets must be booked ahead, local events or holidays on those dates, and entry requirements if crossing borders. Say that prices and hours change and give the dates you checked. Without web access, say that details such as opening hours must be verified.
3. Build the itinerary:
   - Group sights by area to avoid crossing a city repeatedly.
   - Plan no more than 2 or 3 major activities per day, and one on arrival and departure days.
   - Include realistic transfer times and meal breaks, and a flexible half-day on longer trips.
   - Put weather-dependent activities early with an indoor alternative.
   - Mark anything needing advance booking with **Book ahead**.
4. Assemble the answer in the order given under Output.

## Gotchas

- Many sights close one day a week. An itinerary that ignores this sends people to locked doors.
- Packed days look efficient on paper and fall apart in practice. Count transfers and meals.
- Budget figures are estimates, and prices change. Label them as such.
- Border crossings may need visas or documents with lead times. Check them early.

## Output

1. Summary: route, dates, pace, estimated budget per person (transport, accommodation, food, activities), clearly as an estimate.
2. Day by day: morning, afternoon, evening, with travel notes.
3. Bookings to make, in order of urgency.
4. Practical tips: transport passes, tipping, plugs, safety, useful phrases.
5. A short packing list tailored to the season and activities.

Offer to save it as a .pdf with `create_file` for printing or offline use (see `use_skill` with `pdf`).
