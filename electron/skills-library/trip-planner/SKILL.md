---
name: trip-planner
description: Plans trips with a day-by-day itinerary, realistic travel times, bookings to make, a budget estimate and a packing list, saved as a printable PDF if wanted. Use when the user is planning a holiday, weekend away, business trip or route.
---

# Trip planner

## Collect

Destination(s), dates or length, number and type of travellers (children, mobility needs), budget level, interests, pace (relaxed or packed), how they travel, and anything already booked. Ask for essentials in one message; assume sensible defaults for the rest and state them.

## Research

With web access, use search_web and read_url to check: opening days and hours of key sights (many close one day a week), seasonal closures, travel times between places, whether tickets must be booked ahead, local events or holidays on those dates, and entry requirements if crossing borders. Note that prices and hours change and give dates checked.

Without web access, say that details such as opening hours must be verified.

## Build the itinerary

- Group sights by area to avoid crossing a city repeatedly.
- No more than 2 or 3 major activities per day; one on arrival and departure days.
- Include realistic transfer times and meal breaks, and a flexible half-day on longer trips.
- Put weather-dependent activities early with an indoor alternative.
- Mark anything needing advance booking with **Book ahead**.

## Output

1. Summary: route, dates, pace, estimated budget per person (transport, accommodation, food, activities), clearly as an estimate.
2. Day by day: morning, afternoon, evening, with travel notes.
3. Bookings to make, in order of urgency.
4. Practical tips: transport passes, tipping, plugs, safety, useful phrases.
5. A short packing list tailored to the season and activities.

Offer to save it as a .pdf with create_file for printing or offline use.
