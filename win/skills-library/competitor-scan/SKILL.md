---
name: competitor-scan
description: Builds a dated, sourced map of competitors for a product or business using only public pages, grouping direct, indirect and substitute options and comparing what each actually offers. Use when the user asks who their competitors are, wants a competitive overview, or asks how they compare with rivals.
---

# Competitor scan

## Goal

Give the user a clear view of who else solves the same problem, how they position themselves and where the gaps are. Every fact has a URL and a date, since competitor pages change often.

## When to use

- The user is starting, pivoting or pitching and needs the field mapped.
- The user wants a feature, price or positioning comparison against named rivals.
- For comparing consumer products to buy, use `use_skill` with `product-comparison-research`. For market size, use `market-sizing-sources`.

## Steps

1. **Define the job to be done.** Ask with `ask_user` what the customer is trying to get done, for whom, and in which region. Competitors are defined by the job, not the category label.
2. **Build the candidate list.** Use `search_web` with the problem phrased in customer words, "alternatives to X", and category lists. Collect names without judging.
3. **Sort into three groups.** Direct (same job, same customer), indirect (same job, different approach) and substitutes (spreadsheet, agency, doing nothing).
4. **Read each competitor's own pages.** Use `read_url` on the home page, pricing, features and about pages. Record claims as claims.
5. **Read outside views.** Search for independent reviews, user forums and comparison posts. Note recurring complaints and praise.
6. **Fill one table.** Columns: name, group, target customer, core offer, pricing model, notable strength, notable gap, source and date. Leave a cell empty rather than guess.
7. **Find patterns.** Look for crowded areas, empty areas and claims everyone makes. Offer two or three observations, labelled as inference.
8. **Save.** Write the table and notes to a file with `create_file` if the user wants to keep them.
9. **Check momentum.** Look at release notes, hiring pages and funding news for each main rival, and mark who is growing or fading.
10. **Ask what is missing.** List customer needs from step 1 that no listed competitor serves well.

## Gotchas

- Founders list only products that look like theirs. The usual real rival is a substitute, so always fill that group.
- Marketing pages list planned or beta features next to shipped ones. Check docs, changelogs or a free trial page for what exists.
- Pricing pages hide tiers, per-seat rules and usage limits. Record the pricing model and the date, and avoid computing a single figure unless the page gives one.
- Review sites rank by affiliate payout in some categories. Weigh forum and user posts higher than top ten lists.
- Do not sign up, scrape logged-in areas or use private material. Public pages only.
- A competitor with no recent activity may be dead. Check the latest blog post, release or social update before listing it as active.
- Superlatives on rival pages ("fastest", "most trusted") are claims. Quote them with attribution or leave them out.
- Regional rivals vanish from English searches. Repeat the search in the local language of the target market.
- A gap nobody serves may be a gap nobody pays for. Mark gaps as hypotheses until demand evidence exists.

## Output

A table of competitors by group, then five lines at most of observations and open questions. Each row links its sources. State the date of the scan at the top.
