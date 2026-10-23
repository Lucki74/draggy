---
name: salary-research-plan
description: Plans how to find current pay ranges for a role and location from sources the user can check, and builds the evidence for a pay conversation. Use when the user asks how much to ask for, wants to research salary for a role, or prepares for a pay discussion or offer.
---

# Salary research plan

## Goal

Give the user a defensible pay range for a specific role, place and level, built from live sources they can cite. The skill does not state market figures from memory, since they change and vary by place.

## When to use

- The user has an offer or an upcoming pay talk.
- The user wants to know whether current pay is in line.
- Reading the offer's role first is `use_skill` with `job-posting-analysis`.

## Steps

1. Ask with `ask_user` for the exact title, the level, the years in similar work, the city or remote policy, the industry, the company size, and the currency.
2. Ask what the number will be used for: a new job, a raise, a freelance rate or a counteroffer. Ask for the current package if there is one.
3. Define the unit: base pay, bonus, equity, benefits, and total package. Keep each in its own column from now on.
4. Search with `search_web` for published ranges: the employer's own postings, public pay-transparency postings, government statistics for the occupation and region, and industry surveys. Open each with `read_url` and note the date, sample size when stated, and method.
5. Prefer sources that publish a range for the same title and place. Treat self-reported sites as a signal, and note when the sample is small.
6. Record every data point in a table with source, link, date, title, place, base, total, and a fit score from one to three.
7. Adjust for differences in level, location and company size only in notes. Do not apply made-up multipliers.
8. Build a range from the best-fitting points: a floor, a target and a stretch. State how each was chosen.
9. Add non-pay items worth asking for: start date, review timing, remote days, learning budget, and sign-on terms.
10. Draft the talking points: the range, two or three pieces of evidence, and the user's own results that justify the target.
11. Warn the user to check local rules on pay disclosure with an official source, and leave legal questions to a professional.
12. Save the table and links so the user can show the evidence again in a later round.

## Gotchas

- Quoting a figure from memory as current.
- Mixing hourly, monthly and yearly numbers, or gross and net.
- Comparing a capital city with a small town without saying so.
- Counting an unvested equity grant as cash.
- Giving a range whose floor is below what the user would accept.
- Using one outlier source to anchor the whole range.
- Naming the user's current pay too early when the process allows otherwise. Ask what is customary.
- Overlooking cost of living when the offer involves a move.

## Output

The data table with sources, the floor, target and stretch with reasoning, a list of non-pay terms to raise and a short script for the conversation.
