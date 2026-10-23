---
name: trend-scan
description: Scans a topic for movements that are real and lasting, gathering dated signals from several kinds of sources and sorting them into rising, steady, fading and hype. Use when the user asks what is trending in a field, whether something is a real trend, or what to watch next.
---

# Trend scan

## Goal

Give the user an honest read of where a field is moving. Each trend rests on at least two different kinds of evidence, has dates and carries a confidence level. Noise and hype are named as such.

## When to use

- The user is planning a product, a talk, an investment of time or a content strategy and wants the direction of travel.
- The user heard that something is "booming" and wants it tested.
- For a full-depth study of one trend, use `use_skill` with `deep-research`. For today's headlines only, use `news-brief`.

## Steps

1. **Bound the field.** Fix topic, region and horizon (last 12 months, last 5 years). Use `ask_user` for who the scan serves, since the same field has different trends for a buyer and for a builder.
2. **Collect candidates.** Use `search_web` for recent articles, conference programmes, reports, job postings, standards drafts, repository or package activity and funding news. Write each candidate trend as a plain sentence.
3. **Gather signals per candidate.** Aim for evidence of different kinds: usage or sales data, hiring, money invested, regulation, academic output, search or social interest. Open each with `read_url` and record date and number.
4. **Check the counts.** For each signal ask: what is the base? A rise from ten to twenty is not a wave. Note absolute size beside growth.
5. **Look for the opposing case.** Search for "decline", "abandon", "failed", "overhyped" next to each candidate and read what comes back.
6. **Classify.** Rising (several signal types up, with real base), steady (flat but large), fading (signals down), hype (talk up, usage flat) or unclear (not enough evidence).
7. **Assess drivers.** For the top few, name what pushes the trend (cost drop, rule change, new capability) and what could stop it.
8. **Set confidence.** High, medium or low per trend, based on the number of independent signal types.
9. **Check the lifecycle.** Compare with past waves in the field that looked similar and note which signals separated the lasting ones.
10. **Date the scan.** Put the scan date and horizon at the top, since trends decay.

## Gotchas

- Coverage in the press follows novelty. Ten articles may share one press release.
- Search interest measures curiosity. It can peak with a news story and then fall without any adoption.
- Funding follows fashion and lags real use. It is a signal about investors.
- Surveys by vendors tend to confirm the vendor's market. Mark them.
- Survivorship: the visible winners hide the many that stopped. Look for what is no longer discussed.
- Do not forecast numbers. Describe direction, evidence and uncertainty.
- Job postings show intent to hire, and the same role is often reposted. Count distinct employers.
- Repository stars and downloads can be bought or automated. Check for real issues, releases and contributors.
- A trend in one country may not travel. State where the signals come from.

## Output

A table with columns trend, class, key signals (with dates and links), driver, risk and confidence. Under it, a short "watch list" of two or three items and what signal would change your view.
