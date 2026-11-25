---
name: dataset-finder
description: Finds public datasets that could answer a question, then checks each for licence, coverage, format, update date and fields before the user commits to one. Use when the user asks where to get data on a topic, which dataset to use, or whether open data exists for a question.
---

# Dataset finder

## Goal

Hand the user two to four candidate datasets, each vetted enough to know whether it fits. The user learns what each contains, what they may do with it and what problems to expect, before any download.

## When to use

- A project, analysis or model needs data and the user does not know where to look.
- The user found a dataset and wants to know if it is fit for the question.
- To analyse the data once chosen, use `use_skill` with `exploratory-analysis`. For cleaning, use `data-quality-audit`.

## Steps

1. **Pin the question and the unit.** Ask with `ask_user` what exactly will be measured, for which places, which years and at what level (person, firm, city, day). Row-level and aggregate data answer different questions.
2. **List likely holders.** Think who collects this: statistics offices, regulators, international bodies, research archives, city portals, companies with open programmes. Use `search_web` for the topic plus words like open data, dataset, download, API.
3. **Open the data pages.** Use `read_url` on each candidate's landing page or data dictionary. Record publisher, title, description and the last update date.
4. **Check the licence.** Find the terms of use. Note whether reuse, redistribution and commercial use are allowed and whether attribution is required. If no licence is stated, say so.
5. **Check coverage.** Years, geography, population, missing periods, and any changes of definition between releases.
6. **Check format and size.** File type, size, API limits, encoding, and whether a codebook is provided. If a small sample is downloadable and the user wants it, fetch it with `run_command` into the scratchpad and look at the header and a few rows.
7. **Check fit to the question.** Confirm the fields you need exist and are not empty. Note how each key variable is defined.
8. **Check provenance.** Find how the data was collected and who cleaned it. Prefer the original collector to a mirror.
9. **Rank.** Order candidates by fit, then by openness, then by freshness.
10. **Look for a citation trail.** Search for papers that used the dataset and read how they cleaned it and what trouble they hit.
11. **Name a fallback.** Keep a second-best dataset ready in case access, licence or quality fails.

## Gotchas

- Mirrors on aggregator sites are often out of date and lose the codebook. Link the publisher.
- Definitions shift across years, so a smooth series may hide a break. Read the notes on methodology changes.
- Personal data in a "public" dataset can still be restricted by law or terms. Flag it and do not suggest linking it to identify people.
- A dataset described as "complete" may only cover reporting units. Read who is missing.
- Downloads from unknown hosts can be unsafe. Fetch only from the publisher's own domain, and ask first.
- File size on the page may be compressed. Check before assuming it fits in memory.
- API access often needs a key and has rate limits. Check the terms before planning a large pull.
- Machine-generated or scraped datasets can hold duplicates and spam. Look for a note on how they were built.

## Output

A table of candidates: name, publisher, years and places, unit, format, licence, last update, link. Under it, a short pick with the reason and the two risks that matter most. State any fields that must be checked after download.
