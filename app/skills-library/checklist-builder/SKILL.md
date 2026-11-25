---
name: checklist-builder
description: Turns a repeated task or a past mistake into a short ordered checklist with items that can be checked, pause points and a clear start and end. Use when the user asks for a checklist, keeps forgetting a step, or wants to make a routine task reliable.
---

# Checklist builder

## Goal

A checklist short enough to use every time, whose items catch the mistakes that actually happen. Each item is a check that someone can tick as yes or no.

## When to use

- The user does a task repeatedly (a trip, a release, an event, an onboarding) and wants it reliable.
- The user missed something once and wants it never to happen again.
- For a full procedure with roles and exceptions, use `use_skill` with `process-documenter`.
- For release checks on software, use `use_skill` with `deploy-checklist`.
- The user wants to hand a routine to a new person and make quality independent of memory.

## Steps

1. Ask with `ask_user` what the task is, when it is done, and what has gone wrong before. The failures matter more than the ideal flow.
2. Walk through the task from trigger to finish and write every action in the order done. Ask the user to confirm the order by telling you what comes first and last.
3. Choose the type. A read-do list fits unfamiliar or step-by-step work: do each item in order. A do-confirm list fits skilled work: do from memory, then pause and confirm. Say which one you chose.
4. Cut. Keep items that are easy to forget, costly to miss, or not obvious. Remove steps nobody ever skips. Aim for 5 to 12 items per list. Over 15, split into phases.
5. Rewrite each item as a check: a short verb phrase plus a condition ("Passport valid for 6 months after return date"). Avoid vague words like "ensure" and "consider".
6. Insert pause points where a mistake becomes hard to undo (before sending, before paying, before deleting). Mark them with a "Stop and check" line.
7. Add the failure items. For each past mistake, add the item that would have caught it. If the user had no failures, ask what a new person would likely get wrong.
8. Add an owner when more than one person runs the list, and a "last updated" date.
9. Test it. Ask the user to run it mentally against the last time they did the task. Note items that were missing, wrong order or confusing, and revise.
10. Save with `create_file` as markdown with `- [ ]` boxes, or as a printable plain list.

## Gotchas

- Long lists get skimmed and ignored. Cut until each item earns its place.
- Items that cannot be verified ("be careful") do nothing. Use observable conditions.
- Putting items in the wrong order sends people back and forth, and they stop using it.
- Checklists go stale as tools change. Include a date and a review rule.
- Do not mix the plan and the checks. A checklist reminds, it does not teach. Link to a guide for details.
- A checklist for a medical, legal or safety-critical procedure needs an expert's review. State that.
- After the first three uses, ask what items were skipped or added by hand. That feedback is the best edit source.

## Output

The checklist with a title, trigger, phases, items with checkboxes, pause points marked, and a footer with owner and date. Add one line about how often to review it. Offer to save it with `create_file`.
