---
name: local-guide-research
description: Researches a destination or neighbourhood for sights, food, transport and local customs, with dated sources and a short plan. Use when the user asks what to do in a town, wants a neighbourhood researched before a visit, or asks for local tips for a destination.
---

# Local guide research

## Goal

Build a short, sourced guide for a place the user will visit: what is worth seeing, how to get around, what to eat, and what to know before arriving.

## When to use

- The user is going somewhere new for a day, a weekend or longer.
- The user is considering moving to a neighbourhood and wants a feel for it.
- Putting the findings into a day plan is `use_skill` with `trip-planner`.

## Steps

1. Ask with `ask_user` for the place, dates, interests, group makeup, pace, mobility needs and budget level.
2. Search with `search_web` for official tourism or city pages first, then local news, and independent writers who live there. Open the best with `read_url`.
3. Note the date of each source. Treat anything older than a couple of years with care for prices, hours and closures.
4. Pull out sights and activities that match the interests, and mark which ones need booking ahead.
5. Check opening days, seasonal closures and events on the visit dates, such as festivals or market days, on official pages.
6. Research transport: how to arrive from the airport or station, local passes, whether tickets can be bought on the day, and walking distances.
7. Research food: local dishes and how meals are timed, tipping customs, and areas with many options. Rely on several sources and not on one list.
8. Research customs and rules: dress at religious sites, photo rules, quiet hours, scams that visitors commonly meet, and emergency numbers from an official source.
9. For a neighbourhood, add daily-life points: shops, transport links, noise, green space, and what residents say, noting the sample is small.
10. Cluster the findings by area so the user can group visits, and give a two- or three-day sketch if asked.
11. Mark what is uncertain or disputed between sources, and list what the user should verify before leaving.
12. Save the guide with `create_file`, with links and dates beside every claim.

## Gotchas

- Relying on one blog from years ago.
- Missing seasonal closures.
- Skipping local transport rules and customs.
- Copying popular lists that favour crowds over the user's interests.
- Treating a review score as a fact about quality.
- Giving safety claims about an area without an official or recent source.
- Quoting prices and hours from memory.
- Ignoring the time of year, which changes crowds and weather.

## Output

A guide with sights, transport, food, customs and practical notes, grouped by area, with dated links and a list of items to verify.
