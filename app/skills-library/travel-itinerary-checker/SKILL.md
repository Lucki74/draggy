---
name: travel-itinerary-checker
description: Checks a trip plan for impossible connections, tight transfers, closed venues and missing bookings, and lists the fixes. Use when the user asks to check an itinerary, whether a travel plan is realistic, or to review a trip schedule.
---

# Travel itinerary checker

## Goal

Find the problems in a plan before the user pays for them: times that do not add up, places that are closed that day, and gaps where nothing is booked.

## When to use

- The user has a day-by-day plan or a set of bookings and wants a second look.
- A flight or train time has changed and the rest may no longer fit.
- Building the plan from scratch is `use_skill` with `trip-planner`.

## Steps

1. Read the plan with `read_file`, or take the user's pasted text. Ask with `ask_user` about travellers, mobility needs and the pace they like.
2. Build a timeline of every leg and stay in the order they happen, with dates, times and time zones. Flag any missing time.
3. Check each transfer: arrival time, time to leave the station or airport, and travel to the next point. Use `search_web` for typical times and name the source.
4. Check the minimum connection time between flights or trains on the same ticket and on separate tickets. Warn that separate tickets carry the risk on the traveller.
5. Check venue opening days and hours on their official pages with `read_url`, including holidays and seasonal closures on the visit dates.
6. Check that every night has a booking and that check-in times match arrival times.
7. Check entry needs for each country, such as passport validity and visas, against the official government source. Tell the user to confirm them there.
8. Count the day load. Flag days with more than a few stops or long transit, and name what could be dropped.
9. Look at time zone changes and the effect on the first day after a long flight.
10. Check that tickets with timed entry have a slot and that the order of visits makes a sensible route.
11. List issues by severity: breaks the trip, costs money, or only annoys. For each, give a fix.
12. Offer a revised timeline with the fixes applied, and list what the user must still book.

## Gotchas

- Counting travel time as zero between stops.
- Ignoring opening days and local holidays.
- Trusting a schedule that was never checked against the live source.
- Missing the date line, which shifts arrival by a day.
- Assuming bags move between separate tickets automatically.
- Planning the first morning after a night flight at full pace.
- Ignoring the time to queue at security and border control.
- Forgetting cancellation terms on non-refundable bookings.

## Output

A timeline, an issue list ranked by severity with the fix for each, the sources checked with dates, and a list of open bookings.
