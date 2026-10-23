---
name: postmortem-writer
description: Writes a blameless postmortem from chat logs, alerts and notes: a factual timeline, impact, contributing factors, what went well, and action items with owners and dates. Use when the user asks for a postmortem, an incident review, or a root cause document after an outage.
---

# Postmortem writer

## Goal

Produce a document the team can learn from: what happened, why the system allowed it, and what will change.

A good postmortem names systems and decisions, never people as the cause, and ends with actions that someone owns.

## When to use

- An incident is over and the user wants the written review.
- The user has raw notes, Slack exports or alert logs to turn into a document.
- For handling the incident while it runs, use `use_skill` with `incident-response`.

## Steps

1. Collect sources. Use `read_file` on notes and exports, `run_command` with `git log` around the incident window, and `search_files` for related alert or config files.
2. Ask with `ask_user` for anything missing: start and end times with time zone, user impact, who was involved by role, and what was changed to fix it.
3. Build the timeline in order, one line per event with a timestamp: detection, first response, each action, mitigation, recovery. Mark each entry as fact or inference.
4. Quantify impact from data the user gives: duration, affected users or requests, failed jobs, money or data effects. Leave a visible blank instead of estimating.
5. Separate detection time, response time and resolution time. They have different fixes.
6. List contributing factors, not a single root cause: the trigger, the missing safeguard, the delayed detection, the unclear runbook. Use the questions "why did the system allow this" and "why did we not see it sooner".
7. Write what went well. It shows which safeguards to keep.
8. Write action items. Each has a verb, an owner, a due date and a type: prevent, detect or mitigate. Cap the list at what the team can finish.
9. Check the language: replace "X forgot" with "the process did not require", and remove adjectives about people.
10. Add a short summary at the top that a manager can read alone.
11. Review the draft against the sources for invented details, then save it with `create_file` as `docs/postmortems/<date>-<slug>.md`.

## Gotchas

- A "human error" root cause ends the learning. Ask what made the error easy to make and hard to catch.
- Timelines built from memory drift. Use timestamps from logs, alerts and chat, and say which clock.
- Action items like "be more careful" or "improve monitoring" never close. Make them specific and testable.
- Mixing time zones turns a 20 minute outage into a 5 hour one on paper.
- Five whys can stop at the first comfortable answer. Keep branching when more than one factor contributed.
- Do not include customer names or secrets from logs in a document that gets shared widely.
- A review held weeks later loses detail. Draft within a few days while people still remember.
- Action items copied from older reviews that never closed show a pattern. Link them instead of repeating them.

## Output

- A markdown document: Summary, Impact, Timeline, Contributing factors, What went well, Action items, Open questions.
- Blanks marked clearly where data was not provided.
- No blame language.
