---
name: win-loss-review
description: Compares closed-won and closed-lost deals to find recurring causes and turns them into changes in how the team sells. Use when the user asks why a deal was lost, wants a win and loss analysis, or asks what their won deals have in common.
---

# Win-loss review

## Goal

Find patterns in how deals ended, with enough evidence to act on, and say plainly when the sample is too small. The output is a short list of changes to try, each linked to what the data showed.

## When to use

- A major deal just closed or was lost and the user wants the lesson.
- The user has a set of closed deals to compare.
- Forecasting open deals is `use_skill` with `deal-review`.

## Steps

1. Ask with `ask_user` what period and segment to cover, and what data exists: CRM fields, notes, buyer feedback calls. Load files with `read_file`.
2. Count the deals. If there are fewer than about ten per group, say that any pattern is a hypothesis.
3. For each deal record: segment, size, source, sales cycle length, competitor, number of buyer contacts, and the stated reason for the outcome.
4. Separate the stated reason from the observed one. Read notes for signs such as late-arriving decision makers, no champion, or a missing business case.
5. Use `run_command` to compare groups on the fields you have: cycle length, source, contacts, stage reached. Report differences with the counts.
6. List the top three patterns for losses and for wins, with the deals that illustrate each.
7. For each pattern propose a change the team can test, a sign that it worked, and a review date.
8. List what data to start recording so the next review is better.
9. Suggest short buyer interviews for a few lost deals if notes are thin, and offer a question list.
10. Check that a pattern still holds after removing the largest deal.

## Gotchas

- Taking the buyer's polite reason at face value. Price and timing often cover trust or fit.
- Drawing a rule from three deals. Present small samples as questions.
- Comparing wins and losses from different segments or periods.
- Blaming the individual rep. Look at process and qualification first.
- Survivorship: only closed deals appear, so deals that stalled forever are missing.
- Reviewing only losses. Wins show what to repeat.
- Letting one dramatic deal define the story. Look at the middle of the data.
- Mixing reasons: a lost deal can have several, so record primary and secondary.

## Output

Sample sizes, the top patterns with evidence, proposed changes with success signals, and a list of data to capture. Label each claim as observed or inferred.

End with the one experiment the team can run first.
