---
name: deal-review
description: Stress-tests one open sales deal by separating what is confirmed from what is assumed and listing the gaps that threaten the close date. Use when the user asks to review a deal, wants to know if an opportunity will close, or needs to prepare for a pipeline review.
---

# Deal review

## Goal

Give an honest read on one opportunity: what is true, what is hoped, and what the user should do in the next week to firm it up. The review ends with a realistic close view and the actions that would change it.

## When to use

- A deal is mid-pipeline and the user doubts the forecast.
- A manager asks the user to defend a deal in a review.
- Cleaning many records at once is `use_skill` with `pipeline-hygiene`.

## Steps

1. Gather the deal facts with `read_file` for notes or an export, and `ask_user` for gaps: amount, stage, stated close date, last contact, stakeholders, competitors.
2. Build a table with six rows: problem and its cost, buyer's stated deadline, budget, decision process, champion and economic buyer, competition. For each, write the evidence and mark it confirmed, assumed or unknown.
3. Check the close date against the buyer's process. If approval steps remain, count how long each takes from the buyer's own history or ask.
4. Check momentum: date of last buyer-initiated contact, not last seller email.
5. Identify the single largest gap, the one that would sink the deal if wrong.
6. List the actions that close each gap, with the person to talk to and a date.
7. State a plain view: on track, at risk, or unlikely, with the reason in one sentence.
8. Suggest what to say to the manager if the date should move.
9. Rank the deals if several are under review, by value times how soon the next decision point is.
10. Ask the user what they would bet on the outcome and compare with the evidence.

## Gotchas

- Treating a champion's enthusiasm as buying power. Ask who signs.
- Believing the CRM close date. It is often set once and never revisited.
- Mistaking activity for progress. Ten seller emails are not one buyer reply.
- Missing the competing internal priority, the quiet reason many deals slip.
- Raising confidence because the user likes the buyer.
- Reviewing without any buyer-side evidence. If everything is assumed, say so first.
- Using stage names as proof. A deal in proposal stage can still have no budget.
- Skipping the legal and procurement steps that often add weeks late in a deal.

## Output

The six-row evidence table, the top gap, a dated action list and a one-line verdict. Keep wording blunt but kind, and never alter the CRM.

If evidence is thin, the best output is the list of questions to ask the buyer this week.
