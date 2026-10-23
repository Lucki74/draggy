---
name: inbox-triage-plan
description: Builds a plan to clear a backlog of emails, messages or notes by sorting each item into act now, schedule, hand off, wait or archive, with a time cap and a routine to keep it clear. Use when the user says their inbox is out of control, asks how to catch up on a backlog, or wants rules for triaging messages.
---

# Inbox triage plan

## Goal

A one-time sweep plan and a lasting routine. After the sweep, every item has a decision, and the user knows when the inbox is checked and what counts as done.

## When to use

- The user has a large backlog of messages, notes or requests.
- The user wants a repeatable way to process incoming items.
- For sorting actual emails the user pastes in, use `use_skill` with `email-triage`.
- For drafting replies, use `use_skill` with `email-writer`.
- The user returns from leave or travel to a full inbox and needs a way back in.

## Steps

1. Size the problem. Ask with `ask_user` for the rough count, how far back it goes, the channels (email, chat, notes), and how many hours are available this week for clearing it.
2. Pick a cut-off. For old items, agree on a date before which things are archived without reading, with a plan to search if someone asks. The user must agree to this step.
3. Define the five outcomes: act now (under two minutes), schedule (needs a longer slot), hand off, wait for someone, archive or delete. Add a "reference" folder only if the user already uses one.
4. Set rules for fast sorting. Ask who gets answered first (a boss, a customer), which senders can be muted or filtered, and which subjects are always archived. Write them as short rules.
5. Plan the sweep in passes. Pass one: scan only senders and subjects, archive the obvious. Pass two: do the two-minute items. Pass three: convert the rest into tasks with a next action and a date, then archive the message.
6. Put a time cap on each pass (for example 30 minutes) and stop when it ends. Resume in the next slot.
7. Design the lasting routine: two or three fixed times per day for messages, notifications off in between, and a rule for when something is truly urgent (a call, not a message).
8. Add a weekly check: count what is left, adjust the rules, unsubscribe from two sources.
9. If the user shares a sample of items (pasted or in a file read with `read_file`), run a trial sort on ten of them to test the rules and fix the ones that fail.

## Gotchas

- Reading every old message to decide is how backlogs survive. Use sender and subject first.
- Replying while sorting turns a 90-minute sweep into a day. Collect, then act in the second pass.
- Zero inbox as a goal creates pressure. The goal is that nothing important waits unseen.
- Mass archiving without a safety rule worries people. Say that search finds anything archived.
- Filters made in a hurry hide real messages. Review them after a week.
- Do not let the sweep eat deep work time. Schedule it in a block with an end.
- Messages from several channels need one list of next actions. Separate inboxes keep requests from being compared.

## Output

State the sweep's total time budget in the first line, so the cap is part of the plan.

A plan with Cut-off decision, Outcome definitions, Sorting rules, Sweep passes with time caps, Daily routine, and Weekly check. If a trial sort was done, show the results as a table. Under 40 lines.
