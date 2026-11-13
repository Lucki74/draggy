---
name: competitor-matrix
description: Builds a side-by-side matrix of competitors on criteria that buyers care about, with sources and dates for each cell, and reads out the gaps and threats. Use when the user asks to compare competitors, build a competitor matrix, or see how their product stacks up against others.
---

# Competitor matrix

## Goal

A table the user can trust and act on. Each cell holds a checked fact with a source, the criteria come from what buyers weigh, and the reading at the bottom says where the user wins, loses and is the same.

## When to use

- The user wants a structured comparison of three to six rivals.
- The user is preparing positioning, pricing or a sales pitch and needs to know the field.
- For a quick scan of who the competitors are, use `use_skill` with `competitor-scan`.
- For comparing products to buy, use `use_skill` with `product-comparison-research`.
- A sales team needs a battle card and wants to know where rivals are weak.

## Steps

1. Ask with `ask_user` for the user's product, its buyer, and the rivals they know of. Ask who the buyer would pick if the user's product did not exist. That reveals indirect rivals.
2. Fix the set: three to six competitors, at least one indirect (a different way to solve the same problem). Add the user's own product as a column.
3. Choose criteria from the buyer's view. Ask what made recent customers choose or reject. Typical groups are price and plan limits, core capabilities, ease of use, support, integrations and trust signals. Pick eight to twelve rows.
4. Research each rival with `search_web` and `read_url`: pricing page, feature pages, docs, reviews. Record the exact finding, the URL and the date seen. Prices and features change, so do not fill from memory.
5. Fill cells with a fact or a short phrase. Where no public data exists write "unknown", never a guess. Mark claims from the rival's own marketing as "claimed".
6. Treat the user's own column honestly. Ask the user to confirm each cell and challenge any that look generous.
7. Add a row weight if the user has priorities, and score only on rows that are comparable. Skip a total score if the rows differ too much.
8. Read the matrix. List where the user leads, where they trail, where all are the same (not a differentiator), and one gap no one fills.
9. State implications in three bullets: what to emphasize, what to fix, what to watch. Note the review date.

## Gotchas

- Criteria picked by the user's strengths produce a flattering table that buyers will not believe. Start from buyer reasons.
- Pricing pages hide add-ons and limits. Read the footnotes and the plan comparison, and say where limits could not be found.
- A check mark hides depth. "Has integrations" differs from "has the three integrations buyers use". Use short phrases for key rows.
- Public reviews skew to extremes. Use them for patterns, not for counts.
- The matrix is a snapshot. Date every cell source and re-check before quoting in a pitch.
- Rivals in different size classes are not like for like. Group enterprise and small-business offers separately.
- Do not scrape behind logins or use confidential material.
- Rival product names and plan names change. Record the plan name as shown on the date you looked.

## Output

A table with rows as criteria and columns as products, then Where we lead, Where we trail, Open gap, Implications. A Sources list follows with URL and date. Save with `create_file` if it is long.
