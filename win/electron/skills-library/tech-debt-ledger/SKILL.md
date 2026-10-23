---
name: tech-debt-ledger
description: Records technical debt as dated ledger entries with cost, risk, owner and a trigger for paying it, and keeps the ledger ranked and pruned. Use when the user wants to track tech debt, write down shortcuts taken, or prioritise the debt in a repo.
---

# Tech debt ledger

## Goal

Turn vague "we should clean that up" into a short, current list where each item says what it costs today, what could go wrong and when to pay it. A reader should be able to choose the next item in a minute.

## When to use

- A shortcut was taken on purpose and needs a record.
- Planning asks which debt to tackle first.
- A codebase review produced a pile of observations.
- To find candidates first, use `use_skill` with `complexity-hotspots` or `dead-code-finder`.
- A release is rushed and the shortcuts should be written down before they are forgotten.

## Steps

1. Find the existing ledger. Use `search_files` for `DEBT`, `tech-debt`, `TODO(` and a `docs/` folder. Extend a file that exists instead of starting a second one. If none exists, agree a location with the user, such as `docs/tech-debt.md`.
2. Collect candidates from the user's list, review notes, `TODO` and `FIXME` markers, hotspot output and recurring bug areas in `git log` (use `run_command`).
3. Keep only real debt: a known compromise in code that costs time, risk or money now. Drop wishes, taste and plain bugs; bugs go to the tracker.
4. Write each entry with these fields:
   - Title and location (file or module).
   - Why it exists (the deadline or the trade-off).
   - Cost now: time lost, bug rate, blocked work. Use observed facts, not guesses, and mark estimates as estimates.
   - Risk if left: what breaks and how badly.
   - Fix sketch and rough size (hours, days, weeks).
   - Trigger: the event that makes paying it due, such as "before adding a second payment provider".
   - Owner and the date it was recorded or last reviewed.
5. Rank by cost now plus risk, divided by size. Put items that block planned work first.
6. Edit the ledger file with `edit_file` or `create_file`. Keep each entry to about six lines.
7. Prune: remove paid entries, merge duplicates, and mark entries older than a review period as needing a decision (still real, or drop).
8. Link each entry to the ticket, ADR or commit that explains the original trade-off, using `search_files` or `git log` through `run_command`, so the context survives staff changes.
9. Set a review rhythm with the user, such as each quarter, and put the next review date at the top of the ledger.

## Gotchas

- An entry that says only "ugly" or "needs refactor" cannot be ranked. If you cannot name a cost, it may not be debt.
- A ledger without owners and review dates rots into a graveyard. Add both or do not start it.
- Do not log every `TODO`. Many are notes, not debt, and the flood hides the few that matter.
- Debt that hurts only when touched does not need fixing until a trigger fires. Say what the trigger is.
- Estimates grow with unknowns. Give a range and say what was not looked at.
- Do not turn a ledger into a blame list. Describe the decision and its context, not who made it.

## Output

- The updated ledger file, ranked, with fields filled.
- A short summary: top three items with the reason, items dropped, items needing a decision.
- Any entry where cost or risk is a guess, labelled as such.
- The date of the next ledger review.
