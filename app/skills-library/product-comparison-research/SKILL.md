---
name: product-comparison-research
description: Researches products against criteria the user sets, using maker specifications and independent tests or long-term user reports, and ends with a short ranked comparison and the trade-offs. Use when the user asks which product to buy, wants two or more items compared, or asks for the best option for their needs.
---

# Product comparison research

## Goal

Help the user pick a product with evidence. The comparison reflects their own needs and budget, uses specifications from the maker and verdicts from outside testers, and says which prices and details may have changed.

## When to use

- The user is choosing between named products or wants the category surveyed.
- The user wants to know whether a claim in an advert holds.
- For abstract choices between approaches, use `use_skill` with `compare-options`. For a company's rivals in business terms, use `competitor-scan`.

## Steps

1. **Get the needs.** Use `ask_user` for budget, main use, must-haves, deal-breakers, region and anything already owned that must work with the product. Write the criteria as a list and rank them.
2. **Build the shortlist.** If no names were given, use `search_web` to find 3 to 6 candidates from several lists. Include one cheaper and one pricier option as reference points.
3. **Pull the maker specs.** Use `read_url` on each manufacturer page and the manual or datasheet. Record the spec for every criterion, with the model number.
4. **Pull independent evidence.** Look for lab tests, teardown or repair reviews, long-term owner reports and forum threads. Note test method and date. Treat a single review as one data point.
5. **Look for recurring faults.** Search the model name with words like problem, fails, recall, after a year. Count how many separate reports mention the same issue.
6. **Check availability and cost.** Note price ranges, warranty length, spare parts and support in the user's region, with the date seen. Say that prices change.
7. **Score against criteria.** Make a table with criteria as rows and products as columns. Mark each cell met, partly or not met, with a source. Weight by the user's ranking.
8. **State trade-offs.** Name the best pick for the stated needs, a runner-up and the one reason you would change the pick.
9. **Check total cost.** Add consumables, subscriptions, accessories and repair cost over the period the user expects to keep it.
10. **Check fit with what they own.** Confirm ports, formats, sizes or accounts match, using the maker's compatibility page.

## Gotchas

- Many "best of" lists earn commission on the links. Prefer testers who say how they test and buy their own units.
- Spec numbers are measured under different conditions across makers. Battery hours or brightness figures are not directly comparable unless the method matches.
- Model names are reused across years and regions with changed parts. Match the exact model number.
- Star ratings average different uses. Read the low and mid reviews for patterns.
- A new product has no failure history. Say that the data is thin instead of ranking on specs alone.
- Do not quote a price as current. Give the date and tell the user to confirm at the seller.
- Sponsored reviews and unboxing videos often come with free units. Look for disclosure lines.
- Regional versions differ in power plugs, bands, warranty and features. Check the user's market page.
- Do not push the top-rated item if the user's ranked criteria point elsewhere. Their list decides.

## Output

The criteria list, then the comparison table, then a recommendation of three or four sentences with trade-offs. Add a "check before buying" line covering price, version and warranty. Cite sources by link.
