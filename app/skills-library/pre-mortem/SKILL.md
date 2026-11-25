---
name: pre-mortem
description: Runs a pre-mortem by assuming the plan has already failed, listing the likely causes, ranking them and adding preventions and early warning signs. Use when the user asks what could go wrong with a plan or launch, wants to stress-test a project before starting, or asks for a pre-mortem.
---

# Pre-mortem

## Goal

Find the likely reasons a plan will fail while there is still time to change it. The user leaves with a ranked list of causes, a prevention or a fallback for each of the top ones, and signals that tell them early.

## When to use

- A plan, launch, trip, project or decision is set and not yet started.
- The user wants to hear objections now and not after the fact.
- For a running list of risks kept over time, use `use_skill` with `risk-register`.
- For questioning the plan with a long interview, use `use_skill` with `grill-me`.
- After an actual failure, use `use_skill` with `postmortem-writer`.
- The user needs a way to raise objections with a team without sounding negative.

## Steps

1. Get the plan. Ask with `ask_user` for the plan, the date and the success measure, or open the user's file with `read_file`. Restate the plan in two lines and confirm.
2. Set the frame: "It is the day after the deadline and the plan failed badly. Why?" Say it plainly. Writing in the past tense makes causes easier to name.
3. Generate causes across six areas: people and skills, time and scope, money, other parties (customers, vendors, approvers), technology or tools, and outside events. Aim for at least eight causes. If the user adds some, include them.
4. Make each cause specific. "Poor communication" becomes "design and legal do not see each other's changes until week 5".
5. Rate each cause on likelihood and damage as high, medium or low, with a few words of reasoning. Rank by likelihood times damage. Expect two or three clear leaders.
6. For each top cause write a prevention (reduces the chance) and a fallback (limits the damage). Name an owner and a date for the prevention.
7. Add a signal for each top cause: an early, observable sign, such as "no draft by day 10" or "vendor has not replied in 3 days". Include a date to check.
8. Ask the user which causes they believe are unlikely and why. Keep them in the list if the reason is hope only.
9. Update the plan itself. Ask which changes the user will make now, and list them as edits to scope, schedule or staffing.

## Gotchas

- Generic risks ("scope creep", "delays") are filler. Tie each cause to a named person, date or dependency.
- Likelihood is not damage. A rare event that sinks everything can outrank a common annoyance.
- Optimists skip causes that involve their own habits. Ask directly what they themselves might do to cause failure.
- A list with no changes made is theatre. Insist on at least one change to the plan.
- Signals without a date to check are never checked. Put them on the calendar.
- Do not guess probabilities as numbers. High, medium, low is honest enough here.
- Run it before money or commitments are locked in. After that, only fallbacks are left to change.

## Output

Close with the single change the user will make first and the date.

A table: Cause, Likelihood, Damage, Prevention, Fallback, Signal, Owner. Below it a list of Plan changes. Keep the table to the top six and mention the rest in a line.
