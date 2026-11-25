---
name: discovery-call-prep
description: Builds a one-page prep sheet for a first sales call with known facts, open questions in priority order, and exit criteria. Use when the user asks to prep a discovery call, wants questions to ask a lead, or needs a plan for a first conversation with a prospect.
---

# Discovery call prep

## Goal

Walk into the call knowing what is already established, what must be learned, and what a successful end looks like. The sheet fits on one page and the user can read it during the call.

## When to use

- A first or second call with a prospect is on the calendar.
- The user has a lead name, a company, or some notes and wants questions.
- Preparing a product walkthrough belongs to `use_skill` with `demo-script`.
- The user returns after the call with notes: use `use_skill` with `crm-notes-cleanup`.

## Steps

1. Collect what exists: ask for the lead's role, how they came in, and any notes. Use `read_file` for pasted or saved notes.
2. If the company is unfamiliar, use `use_skill` with `account-research` for a brief, or run a short `search_web` yourself.
3. List known facts and mark each as confirmed or assumed.
4. Name the three things the user needs to learn to decide whether this is a fit: the problem and its cost, who decides and how, and the timing driver.
5. Write eight questions or fewer, ordered by priority. Phrase them open. Put a follow-up probe under the two most important ones.
6. Set exit criteria: the facts that must be known and the next step to propose before the call ends, with a date.
7. Add a short plan for the first two minutes: why this call, how long it takes, and what happens after.
8. Check the sheet against the Goal: could someone else run the call from it?
9. Offer a three-line recap template the user can send within a day of the call.
10. List the two risks most likely to derail the call, such as a missing decision maker or a vague problem.

## Gotchas

- Opening with a pitch. Pain that the buyer has not stated in their own words is a guess.
- A long list of questions read in order. The buyer's answers decide the next question.
- Skipping budget and decision process because they feel rude. Ask them as questions about how the company usually buys.
- Forgetting the other attendees. Ask who joins and what each cares about.
- Ending with "I will send some info". Propose a dated next step instead.
- Treating the sheet as a script. The goal is to listen, not to cover every line.
- Leaving out a time check. Calls overrun and the last question is the one that gets cut.

## Output

A one-page sheet: context, known versus assumed, ranked questions with probes, exit criteria, proposed next step. Save it with `create_file` only if the user asks.
- Mark each question with a priority so a short call still gets the first three.
- Name any assumption that rests on a single source.
