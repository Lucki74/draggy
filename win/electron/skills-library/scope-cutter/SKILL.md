---
name: scope-cutter
description: Trims a feature list or plan to the smallest first version that still delivers the core value, and records every cut as deferred with the reason. Use when the user says something is too big, asks for an MVP, wants to descope, or has a deadline the plan cannot meet.
---

# Cutting scope

## Goal

Find the smallest version that still does the one job the user cares about, ship that, and keep everything else on a visible deferred list. A good cut is reversible, honest about what is lost, and does not create a rewrite later.

## When to use

- The plan is larger than the time, people or budget available.
- The user asks "what is the MVP", "what can we drop", "how do we ship sooner".
- A spec has grown while being written and needs a firm edge.
- Nothing is defined yet: use `spec-writing` or `brainstorming` first.
- Sequencing, not cutting, is the need: use `writing-plans`.

## Steps

1. Get the list. Read the spec, plan or ticket with `read_file`, or ask the user to paste it with `ask_user`. Put every item on one numbered list, including implied work such as migrations, error states and docs.
2. State the core value in one sentence: what must be true for this to be worth shipping. If the user cannot say it, work it out with them before cutting anything.
3. Ask for the constraint that forces the cut: a date, a person count, a budget. Use their figure. If there is none, ask what a good first release would be and by when.
4. Classify each item: must (the core sentence fails without it), should (valuable, can follow), could (nice), and drop (nobody asked for it). Challenge every must by asking what breaks for a real user if it is missing.
5. Check dependencies. Use `search_files` and `read_file` to see what code the cut items touch. If a "later" item changes a data model, an API shape or a public contract, cutting it can force a rewrite. Keep the cheap seam in now, not the feature.
6. Prefer cutting breadth over depth: fewer cases, platforms, roles or settings, done properly, rather than every case done badly. Replace automation with a manual step where the volume is low.
7. Do not cut the riskiest unknown just because it is hard. Risk that is deferred still arrives, later and larger. Move it earlier or run a `tech-spike`.
8. Estimate before and after if the user wants numbers, and use `use_skill` with `estimate-work` for the figures.
9. Write the deferred list: each cut item, why it was cut, what the user experiences without it, and the trigger that would bring it back.
10. Confirm the final scope with `ask_user`, then save with `create_file` if a record is wanted.

## Gotchas

- Cutting the unsexy parts (error handling, empty states, data migration) makes a demo, not a release. Check the cut list for them.
- A cut that is silent is a surprise later. Every dropped item goes on the deferred list with its reason.
- "MVP" drifts into "everything, quickly". Hold to the core sentence and check each remaining item against it.
- Cutting a seam that is cheap now and costly later: permissions, IDs, versioned formats, event hooks. Keep the shape, skip the feature.
- Stakeholder pet items survive on volume. Judge them by the core sentence, then tell the user plainly what the evidence says.
- Do not make up effort numbers to justify a cut. Use real counts from the code or label them as rough.

## Output

Three lists: In scope (with the core sentence on top), Deferred (item, reason, user impact, return trigger) and Dropped. Add the one or two cheap seams kept for later. Keep it under about 35 lines and end by asking for approval of the final scope.
