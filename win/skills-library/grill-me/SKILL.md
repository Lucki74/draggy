---
name: grill-me
description: Interviews the user about a plan, idea or decision, one question at a time, until the gaps are closed, then summarizes what was decided and what is still open. Use when the user says grill me, poke holes in this, interview me about my idea, or wants a plan stress-tested before committing.
---

# Grill me

## Goal

Find the holes in a plan by asking, not by lecturing. The user ends with a list of decisions they made on purpose, the assumptions they now see, and the few questions still open.

## When to use

- The user has a plan, pitch, product idea or decision and wants it questioned.
- The user says they are about to commit time or money and wants a check first.
- For imagining the failure after launch, use `use_skill` with `pre-mortem`.
- For generating options from nothing, use `use_skill` with `brainstorm`.

## Steps

1. Read what the user gave you. If a file or link is named, open it with `read_file` or `read_url` so the questions are about their text, not a generic template.
2. State the topic back in one sentence and ask `ask_user` whether that is the right target. Fix it before going on.
3. Build a private list of areas to probe: goal and success measure, who it is for, the riskiest assumption, cost and time, dependencies on other people, what happens if it fails, and what they would do instead. Drop areas the user already covered.
4. Ask one question per turn with `ask_user`. Pick the question whose answer would change the plan most. Offer two or three likely answers only when that speeds the user up.
5. After each answer, do one of three things: accept it and move on, ask one follow-up if it was vague ("faster" with no number), or record a gap and move on.
6. Keep a running tally of decisions, assumptions and open items. Use `update_plan` when the interview is long enough that the user may lose track.
7. Stop when the main areas are closed or the user says enough. Ten to fifteen questions is usually the ceiling.
8. Summarize and ask the user to confirm or correct it before you finish.
9. Check the summary against the Goal: every decision has a reason, every assumption has a way to test it, and nothing the user rejected came back in.
10. If the user wants to continue, point to the sibling skill that fits the biggest open item, such as `project-plan` or `pre-mortem`.

## Gotchas

- Two questions in one message get half an answer. Send one, even when the second feels related.
- Do not argue the user out of their plan. Your job is to surface the weak spot and let them decide, including to ignore it.
- A confident answer is not evidence. When the user states a fact about customers, cost or time, ask once how they know. Mark it as an assumption if the answer is a guess.
- Do not offer your own solution mid-interview. It turns the session into a debate and you stop learning what they think.
- If the user answers "I don't know" three times in a row, stop probing that area and list it as research to do first.
- Closed questions hide gaps. "Do you have a budget?" gets yes. "What is the most you would spend before stopping?" gets a number.
- Tone matters. A flat, curious question gets honest answers. A sharp one ("Why would anyone want that?") gets defensive ones.
- Do not end with a fresh list of ten new worries. Rank the open items and show at most three.

## Output

A short summary in four blocks: Decisions made (one line each), Assumptions to test, Open questions with a suggested owner, and the first next step. Under 200 words unless the user asks for more. Offer to save it with `create_file` as a markdown note.
