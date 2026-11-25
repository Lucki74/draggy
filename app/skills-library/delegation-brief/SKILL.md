---
name: delegation-brief
description: Writes a brief for handing a task to another person, covering the outcome, why it matters, limits, deadline, what they can decide alone and when to check in. Use when the user wants to delegate a task, hand work to an assistant or teammate, or write clear instructions for someone else.
---

# Delegation brief

## Goal

A message that lets the other person do the task well without coming back for basics. They know the result wanted, how good it must be, how much freedom they have, and when to report.

## When to use

- The user is handing work to a colleague, assistant, freelancer or family member.
- The user hands work to an AI agent and wants a clear brief.
- For permanent handover of an area of work, use `use_skill` with `handoff-doc`.
- For a repeatable process written for many people, use `use_skill` with `process-documenter`.
- The user is taking on a first direct report or a first freelancer and has not briefed before.

## Steps

1. Ask with `ask_user` what the task is, who will do it, and what the user will do with the result. Ask about the person's experience with this kind of task. That sets how detailed the brief should be.
2. Write the outcome, not the method. One sentence: "A two-page comparison of three vendors so I can choose on Friday." If the user describes steps, ask what the steps are for, and write that.
3. Add the purpose. One or two lines on why the task exists and who will read the result. Context lets the person make good small choices.
4. Define done. List three or fewer checks: format, length, sources, accuracy level, where it is saved. Say what quality is "good enough" versus "perfect".
5. State limits: deadline with a time zone, budget, tools to use or avoid, things not to touch, and anything confidential.
6. State decision rights. Split into: decide alone, decide and tell me, ask first. Money, external messages and deletions usually go in ask first.
7. Provide material: links, files, previous examples, names of contacts. Check that links open. Use `read_file` on any local file you mention to confirm it is the right one.
8. Set check-ins. Pick one early check (a draft outline or a first result) and the final handoff. For long tasks add a weekly update.
9. Name the first step so the person can start without waiting. Add how to reach the user and when they are available.
10. Re-read as the recipient. Remove anything that needs an unstated fact, and cut it to one page.

## Gotchas

- Describing steps instead of the result gives you a copy of your own method and misses better ones.
- "ASAP" is not a deadline. Give a date and time.
- Delegating without decision rights makes the person ask about everything, which defeats the point.
- Skipping the early check lets a wrong direction run for days.
- A brief for an AI agent needs the same parts plus explicit limits on what it may change.
- Do not delegate and then redo the work silently. Give feedback on the result and say what to change.
- Confidential material goes only to people who may see it. Ask before putting names, prices or personal data in the brief.

## Output

Ask the recipient to repeat the outcome back in one line. A mismatch shows up before work starts.

A message the user can send: Outcome, Why, Done means, Limits, You decide, Materials, Check-ins, Start with. Under 250 words. Offer variants for chat, email or a ticket.
