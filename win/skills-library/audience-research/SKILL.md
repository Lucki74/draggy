---
name: audience-research
description: Researches a target audience from public and first-party sources, collecting their goals, problems, words, channels and objections with dated sources, and separating evidence from assumptions. Use when the user asks for audience research, wants to know who their customers are or where they spend time, or needs insight before marketing.
---

# Audience research

## Goal

A grounded picture of who the audience is, what they want, how they talk and where to reach them. Every claim has a source and a date, and guesses are labeled as such. No private data is collected.

## When to use

- The user is about to launch or reposition and does not know the audience well.
- Messaging underperforms and the user suspects a mismatch.
- To turn findings into a profile, use `use_skill` with `customer-persona`.
- To map the real job behind a purchase, use `use_skill` with `jobs-to-be-done`.
- For turning findings into a plan, use `use_skill` with `campaign-brief`.

## Steps

1. Ask with `ask_user` what is sold, who the user thinks buys, the market, what data exists (surveys, reviews, support logs, analytics) and what decision the research should support. Read supplied files with `read_file`.
2. Start with first-party data: customer emails sent to support, reviews, survey answers, sales call notes and analytics. Pull out recurring goals, problems, phrases and reasons to buy or leave. Strip names and contact details before quoting.
3. Add public sources with `search_web` and `read_url`: forums, review sites, community threads, Q&A pages, industry reports and competitor testimonials. Record the URL and date for each.
4. Capture the audience's words: exact phrases for problems, desired results and alternatives. These feed copy and keyword work.
5. Identify channels: where they ask questions, who they trust, which formats they use. Evidence only; do not assume from demographics.
6. List objections and fears that stop them from buying, and the triggers that start a search for a solution.
7. Segment only where behavior differs. Name segments by need or situation, not by age alone.
8. Rate evidence strength for each finding: seen many times from different sources, seen a few times, or a single mention. Mark gaps and propose how to fill them, such as five interviews or a short survey. See `interview-questions` if the library offers it.
9. Compile the findings into a one-page summary with a short list of implications for messaging, channels and product.
10. Date the document and set a review time. Audiences shift.

## Gotchas

- A loud minority on a forum is not the audience. Check whether a theme appears across sources.
- Undated sources may describe an older market. Note the date and prefer recent material.
- Do not collect or store personal data from private groups or profiles. Use public, aggregated material and consented first-party data.
- Do not present guesses as findings. Keep an assumptions list.
- Survey and review samples are biased toward people with strong opinions. Say so.
- Demographic labels explain less than situations and goals.
- Findings from one country or language do not transfer. Label the market on every finding.

## Output

A summary with segments, goals and problems, quoted phrases, objections, channels, evidence strength, source list with dates, gaps and next research steps.
