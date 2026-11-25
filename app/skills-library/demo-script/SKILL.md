---
name: demo-script
description: Writes a demo run-sheet that shows only the features tied to the buyer's stated problems, in order of importance, with planned pauses and a close. Use when the user asks to script a demo, plan a product walkthrough for a prospect, or structure tomorrow's demo.
---

# Demo script

## Goal

Plan a demo that proves the product solves the buyer's problems, in the buyer's order, in the time available. The run-sheet shows what to say, what to click and what to ask at each point.

## When to use

- A demo or screen-share with a prospect is scheduled.
- The user has discovery notes and an existing product to show.
- Preparing the earlier call is `use_skill` with `discovery-call-prep`.

## Steps

1. Ask with `ask_user` for the time slot, attendees and their roles, and the product areas the user can show. Read discovery notes with `read_file`.
2. List the buyer's problems in their words, ranked by importance to them.
3. Match each problem to one feature or workflow. Drop features that match no problem.
4. Set the opening: restate the problems and ask whether the order is right. This takes two minutes at most.
5. For each block write the problem, the click path, the sentence that links the screen to the problem, and one question to ask the audience.
6. Prepare the data: the sample records and settings must make the story believable. List what to set up beforehand.
7. Plan fallbacks for each block: what to say if a screen fails or loads slowly.
8. Close with a summary tied to the problems and a proposed next step with a date.
9. Add timings. Leave a quarter of the slot free for questions.
10. Rehearse the first five minutes once and time them.
11. Prepare one slide or page of the buyer's problems in case the screen share fails.

## Gotchas

- Touring every menu. Breadth hides the three things the buyer came for.
- Showing features while someone asks about an unrelated worry. Pause and take the question.
- Demoing on a live account with real or untidy data.
- Talking over the screen. Name the point, then stop while they read.
- Promising roadmap items. Only claim what the user confirms exists today.
- Ending on a Q and A with no commitment. Always ask for the next step.
- Clicking through settings the buyer does not care about while the clock runs.
- Using internal jargon for features. Use the buyer's labels.

## Output

A timed run-sheet with blocks, click paths, linking lines and audience questions, plus a pre-demo setup checklist and the closing ask.

Offer a short follow-up email after the demo that restates the agreed next step.
