---
name: focus-session-plan
description: Plans a single focused work session with one outcome, a time box, a prepared setup, a distraction plan and a stop rule, and helps the user start when they are stuck. Use when the user says they need to focus, asks for a work sprint, or has trouble starting a task.
---

# Focus session plan

## Goal

One session, 25 to 90 minutes, that produces a specific result. The user begins within five minutes of reading the plan and knows when to stop and what to do with leftovers.

## When to use

- The user has one task to push through and wants a structure for the next block.
- The user is procrastinating and wants a way in.
- For planning the whole day, use `use_skill` with `daily-plan`.
- For placing several sessions on a calendar, use `use_skill` with `time-blocking`.
- The user has a deadline close by and needs the next hour to count.

## Steps

1. Ask with `ask_user` what the task is, how long the user has, and how they feel about it (clear, dreaded, unclear). The third answer sets the approach.
2. Define the outcome for this session only: a result visible at the end, such as "first draft of section 2" or "the failing tests listed". If the task is too big, take the first slice.
3. Pick the box. Default is 45 minutes. Use 25 for a dreaded task, 60 to 90 for flow-type work like writing or design. Add a 5 to 10 minute break afterwards.
4. Prepare the setup in a short list: files and tabs to open (name them), tools, water, a note for stray thoughts. Do the preparation before the timer starts, not inside it.
5. Set a distraction plan. Ask what usually pulls them away, then pick two rules: notifications off, phone out of reach, a capture note for new ideas, and a rule to not answer messages until the box ends.
6. If the user is stuck at the start, offer a five-minute entry task: write the first ugly sentence, open the file and list the headings, or write what they already know. Starting is the aim.
7. Set the stop rule. When the timer ends, stop even in the middle of a sentence, write the next action on a note, and take the break. Allow an extension only if they say yes at the end.
8. After the session, ask two questions: was the outcome met, and what got in the way. Use the answers to size the next session.
9. If they want to run several, space them with breaks and cap at three or four a day.

## Gotchas

- A vague outcome like "work on report" has no end. Name what exists at the end.
- Preparing during the timer eats it. Prepare first.
- Pushing through without breaks lowers the next session. Count breaks as part of the plan.
- A dreaded task with a 90-minute box makes starting harder. Shrink the box.
- Stray ideas and chores that appear mid-session go to the capture note, not into action.
- If the real blocker is an unclear task, spend the session on clarifying it and call that the outcome.
- Tiredness and hunger look like laziness. Suggest food, water or a walk before blaming the task.

## Output

If the user reports back after the session, update the plan with the actual outcome and the next slice.

A short plan: Outcome, Box length, Setup list, Distraction rules, Start move, Stop rule. Under 12 lines. End with a direct instruction to start now.
