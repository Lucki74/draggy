---
name: process-documenter
description: Documents how a recurring process actually works, with purpose, roles, inputs, ordered steps, exceptions and measures, so a newcomer can follow it. Use when the user asks to document a process, write down how the team does something, or create an SOP.
---

# Process documenter

## Goal

A document that matches what really happens and is clear enough for a new person to run the process unaided. It records the real flow, including the exceptions people handle by habit.

## When to use

- A process lives in people's heads and needs to be written down.
- The user wants an SOP, runbook or how-we-do-it page for a team.
- For a short tick list of a repeat task, use `use_skill` with `checklist-builder`.
- For transferring a whole area of work to a successor, use `use_skill` with `handoff-doc`.
- The user is preparing for an audit or onboarding and needs the process in writing.

## Steps

1. Frame it. Ask with `ask_user` for the process name, its trigger, its end result, who runs it and how often. Ask for the reader: new hire, auditor, or the author's future self.
2. Collect the real flow. Ask the user to describe the last time it was run, step by step, including waits and rework. If tickets, emails or files exist, read them with `read_file` or `search_files` to see what happened.
3. Mark the start and end. The start is the trigger event; the end is the state that proves the process finished.
4. List roles. For each step name who does it. Use roles ("approver") plus current holders in brackets so the page survives staff changes.
5. Write the steps as numbered actions starting with a verb. Each has an input, an output and a place (tool, folder, system). If a step has more than one decision, give each branch its own line.
6. Collect exceptions. Ask: what goes wrong, what do you do when X is missing, who decides when rules conflict. Add each as "If ..., then ...".
7. Add timing and measures: how long each phase usually takes, what a good run looks like, and one or two numbers worth tracking. Do not invent numbers; use the user's.
8. Note tools and access, templates used and links. Check that links work with `read_url` where possible.
9. Draw the flow in text if it has branches: a list of Start, Step, Decision, End lines is enough.
10. Test on a newcomer. Ask the user if someone not involved can follow it, or walk through it yourself and list questions that remain. Fix those.
11. Add owner, date and review schedule at the top. Save with `create_file`.

## Gotchas

- People document the official process rather than the one they actually follow. Ask for the last real run.
- Skipping the exceptions leaves out the hard part, which is the reason to document.
- Names of people as owners go out of date. Use roles and a named maintainer for the doc.
- A long process in one list becomes unreadable. Split into phases of seven steps or fewer.
- Do not smooth over a bad process by documenting it neatly. Note pain points in a separate section for later fixing.
- Screenshots and file paths change. Prefer names and short descriptions.
- Interview two people who run the process. The differences between their accounts show where the real variation is.

## Output

A markdown document: Purpose, Scope, Roles, Inputs, Steps (numbered, by phase), Exceptions, Measures, Tools and access, Pain points, Owner and review date. Aim for two pages or less, with details linked.
