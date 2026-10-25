---
name: lead-qualification
description: Scores leads against a fit and intent rubric the user states, then labels each pursue, nurture or drop with the evidence behind the call. Use when the user asks whether a lead is worth chasing, wants to qualify a prospect, or has a list of leads to rank.
---

# Lead qualification

## Goal

Decide where each lead belongs using criteria the user has set, and show the evidence so the user can overrule the call. The skill never replaces the user's rubric with its own.

## When to use

- One lead or a list needs a pursue, nurture or drop decision.
- The user has a spreadsheet or CRM export of leads.
- A deep brief on a single company is `use_skill` with `account-research`.

## Steps

1. Ask with `ask_user` for the rubric: what makes a good fit (size, sector, role, geography) and what shows intent (replies, requests, trigger events). If the user has none, propose a short one and get approval before scoring.
2. Load the leads. For a file use `read_file`; for a large CSV use `run_code` to count rows, check columns and find blanks.
3. List the fields each criterion needs. Mark any lead missing a field as unknown, not as failing.
4. Score fit and intent separately on a small scale, such as high, medium, low. Keep a note of the evidence for each score.
5. Map the pair to an action: high fit and high intent is pursue now, high fit and low intent is nurture, low fit is drop unless intent is strong.
6. Run `run_code` for a list to produce the sorted table and a count per action. Spot-check three rows by hand.
7. Show the rows closest to a boundary and ask whether the user agrees with the placement.
8. Report what data would most change the ranking.
9. Re-run the scoring if the user edits the rubric and show what moved between actions.
10. Offer a cheap next check for each unknown lead, such as a public profile or a short question.

## Gotchas

- Scoring on company size alone. A large firm with no relevant role is a poor lead.
- Reading a polite reply or an email open as intent.
- Treating missing data as a low score. Unknown leads need a cheap check, not a drop.
- Adding criteria the user never stated, such as industry prestige.
- Collapsing fit and intent into one number, which hides why a lead scored as it did.
- Changing the rubric midway through a list. Re-score everything if it changes.
- Ranking by who replied fastest. Speed of reply says little about budget.
- Dropping a lead the user already likes without saying why it fails the rubric.

## Output

A table with lead, fit, intent, action and one line of evidence, plus counts per action and a short list of leads needing more data. The user decides the final calls.

Always state how many leads were scored and how many had missing data.
