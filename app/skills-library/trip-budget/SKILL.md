---
name: trip-budget
description: Builds a trip budget by category with live price checks, a buffer and a daily spending target, and sets up a way to track actual spend. Use when the user asks how much a trip will cost, wants a travel budget, or needs to track spending on holiday.
---

# Trip budget

## Goal

Estimate what a trip will cost from live prices, set a daily target for the days away, and make it easy to see during the trip whether spending is on track.

## When to use

- The user is deciding whether a trip is affordable.
- The user wants a spending limit per day while travelling.
- The itinerary itself is `use_skill` with `trip-planner`.

## Steps

1. Ask with `ask_user` for the destination, dates, travellers, home currency, total limit if any, and the style of travel.
2. List the categories: transport there and back, local transport, lodging, food, activities, insurance, visas and fees, gear, and a reserve.
3. Check fares and room prices on the day with `search_web` and `read_url`. Record the source, the date and the price for the dates chosen.
4. Estimate food and local transport from sources that publish typical costs for that place, noting the date. Show a low and a high figure.
5. Look up entry fees for planned activities on the official sites.
6. Find the current exchange rate from a live source and note the date. Show amounts in both currencies, and add a margin for card fees and cash exchange.
7. Include costs before and after the trip, such as airport transfers at home, pet care and lost income.
8. Add a reserve of about a tenth for surprises, and say that the user may change the figure.
9. Compute the totals and per-day target with `run_command` if sums are long. Show the arithmetic.
10. Build the tracking sheet with `create_file`: date, category, amount in local and home currency, payment method and a note.
11. Define the check: compare actual against the daily target each evening, and carry the surplus or deficit forward.
12. If the total exceeds the limit, list the cuts by effect: dates, lodging, route, and activities.

## Gotchas

- Leaving out transfers and local transport.
- Using exchange rates from memory.
- No buffer for surprises.
- Pricing flights for dates other than those planned.
- Forgetting that tips, taxes and resort fees may be added to the displayed price.
- Counting a deposit as the full cost.
- Ignoring card fees and withdrawal fees.
- Skipping the bank statement check after the trip.

## Output

A budget table with low, high and chosen figures, sources and dates, a daily target, and a tracking sheet.
