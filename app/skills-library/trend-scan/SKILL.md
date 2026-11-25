---
name: trend-scan
description: Scans a topic for movements that are real and lasting, gathering dated signals from several kinds of sources and sorting them into rising, steady, fading and hype. Use when the user asks what is trending in a field, whether something is a real trend, or what to watch next.
---

# Trend scan

## Goal

Give the user an honest read of where a field is moving. Each trend rests on at least two kinds of evidence, has dates and carries a confidence level. Noise and hype are named as such.

## When to use

- The user is planning a product, a talk, an investment of time or a content strategy and wants the direction of travel.
- The user heard that something is "booming" and wants it tested.
- For a full study of one trend, use `use_skill` with `deep-research`. For today's headlines only, use `news-brief`.

## Steps

1. Bound the field. Fix the topic, region and horizon (last 12 months, last 5 years). Use `ask_user` for who the scan serves, since a buyer and a builder see different trends.
2. Call `start_research` with depth `standard`. Use source `web`, and add `papers` for research activity and `code` for repository and package activity where they bear on the field. The user approves the plan first.
3. Collect candidates with `search_web`: recent articles, conference programmes, reports, job postings, standards drafts, and funding news. Write each candidate as a plain sentence.
4. Gather signals per candidate. Aim for different kinds of evidence: usage or sales data, hiring, money invested, regulation, academic output, search or social interest. Open each source with `read_url` and record the date and the number with `add_note`.
5. Check the counts. For each signal ask what the base is. A rise from ten to twenty is not a wave. Record the absolute size beside the growth.
6. Look for the opposing case. Search for "decline", "abandoned", "failed" and "overhyped" next to each candidate, and read what comes back. Use `search_notes` to compare the signals.
7. Classify each candidate: rising (several signal types up, on a real base), steady (flat but large), fading (signals down), hype (talk up, usage flat), or unclear (not enough evidence).
8. For the top few, name what drives the trend (cost drop, rule change, new capability) and what could stop it.
9. Set confidence per trend, high, medium or low, from the number of independent signal types.
10. Compare with past waves in the field that looked similar, and note which signals separated the lasting ones.
11. Call `finish_research`, then write the scan with the scan date and horizon at the top, since trends decay.

## Gotchas

- Press coverage follows novelty. Ten articles may share one press release.
- Search interest measures curiosity. It can peak with a news story and then fall without any adoption.
- Funding follows fashion and lags real use. It is a signal about investors.
- Surveys by vendors tend to confirm the vendor's market. Mark them.
- Survivorship: visible winners hide the many that stopped. Look for what is no longer discussed.
- Do not forecast numbers. Describe direction, evidence and uncertainty.
- Job postings show intent to hire, and the same role is often reposted. Count distinct employers.
- Repository stars and downloads can be bought or automated. Check for real issues, releases and contributors.
- A trend in one country may not travel. State where the signals come from.

## Output

A table with columns trend, class, key signals (with dates and links), driver, risk and confidence. Under it, a short watch list of two or three items, each with the signal that would change your view.
