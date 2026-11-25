---
name: decision-journal
description: Records a decision before the outcome is known, with the options, reasons, assumptions, expected result and a review date, so the choice can be judged later on its process. Use when the user wants to log a decision, asks to remember why they chose something, or wants to review an old decision.
---

# Decision journal

## Goal

A short entry written at the time of the decision that the user can open months later and judge fairly. It separates the quality of the reasoning from the luck of the result.

## When to use

- The user is about to make or has just made a non-trivial choice and wants it recorded.
- The user wants to revisit an earlier entry and learn from it.
- For comparing options before choosing, use `use_skill` with `compare-options`.
- For a software design record, use `use_skill` with `adr-writer`.
- The user keeps making similar choices and wants to see their own pattern.

## Steps

1. Ask with `ask_user`: what is the decision, and when must it be made. Write it as a question ("Do I take the offer from X?").
2. Ask for the options actually considered, including doing nothing. Two options is a thin list; prompt once for a third.
3. Ask for the reasons for the leading choice and the main reason against it. Record both.
4. Ask what the user is assuming to be true and how sure they are, from 50 to 90 percent in rounded numbers. Do not accept 100.
5. Ask what they expect to happen if they choose this, in a form that can be checked later, and a date to check it.
6. Ask for the state of mind: tired, rushed, excited, under pressure. It affects how to read the decision later.
7. Write the entry with the date and the fields in a fixed order. Use plain words and the user's own phrasing.
8. Set the review. Put the review date in the entry and offer to create a reminder as a line at the top of the file.
9. When the user returns to review: read the entry with `read_file`, ask what actually happened, mark which assumptions held, and write a two-line lesson. Judge the process first, the outcome second.
10. Save with `create_file` or append with `edit_file` to the user's journal file.

## Gotchas

- An entry written after the outcome is a story. If the user is backfilling, mark it as written after the fact.
- Good outcomes from bad reasoning teach the wrong lesson. Score the reasoning separately.
- Without a review date the journal is never read. A date is part of the entry.
- Expected results like "it will go well" cannot be checked. Push for something with a number, a date or an observable event.
- Keep entries short. Over a page and the user stops writing them.
- Do not use it for choices where a wrong guess is cheap and reversible. Suggest a coin flip instead.
- After several reviews, look across entries for repeated errors such as overconfidence on timing. That pattern is the main payoff.

## Output

If the journal file already exists, add the new entry at the top and leave older ones unchanged.

An entry with these headings: Date, Decision, Options, Choice and reasons, Against, Assumptions with confidence, Expected result, State of mind, Review on. Under 25 lines. At review time add Outcome, What held, What did not, Lesson.
