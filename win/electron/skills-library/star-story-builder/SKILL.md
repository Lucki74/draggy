---
name: star-story-builder
description: Turns a rough work memory into a short story with situation, task, action and result that can be adapted to several behavioural questions. Use when the user asks for help with STAR answers, wants to turn an experience into an interview story, or prepares for behavioural questions.
---

# STAR story builder

## Goal

Help the user turn real experiences into tight, truthful stories of about two minutes that show what they did and what came of it. One good story should work for three or four different questions with a change of emphasis.

## When to use

- The user has experiences but cannot say them clearly.
- The user is asked tell me about a time when and freezes.
- A full prep plan for a given interview is `use_skill` with `interview-prep`.

## Steps

1. Ask with `ask_user` for the memory in the user's own rough words, with no polishing. Ask when it happened, the team, and the stakes.
2. Ask follow-up questions in this order: what was the situation, what were you responsible for, what did you personally do, what happened, what did you learn or change.
3. Separate the user's actions from the team's. Ask for the specific decision the user made and the reason for it.
4. Find the result. Ask for anything measurable: time saved, money, errors, people reached, a decision made. If no number exists, ask for the visible outcome. Do not invent a figure.
5. Draft the story in four short parts: situation in two sentences, task in one, actions in three or four steps starting with I, result in two sentences with the lesson.
6. Cut background that a listener does not need. A story over about 250 spoken words is too long.
7. List the questions the story could answer, such as conflict, ownership, failure, deadline, influence and learning, and note which part to stress for each.
8. Check honesty: ask the user whether every statement is true as written and whether they could answer three follow-up questions about it.
9. Read it aloud once with the user and mark any phrase that sounds unlike them.
10. Save the stories as a list with `create_file`, each with a title, the questions it fits and the numbers it uses.
11. Tag each story with the skills it shows, so the user can pick one fast during an interview.
12. Rehearse each story twice with a timer, aiming for about two minutes.

## Gotchas

- Saying we throughout, so the listener cannot tell what the user did.
- Ending without a result, or with a result that has no link to the user's actions.
- Choosing only successes. One story about a mistake and what changed shows judgement.
- Making the story fit by exaggerating scope or numbers.
- Memorizing words instead of the beats.
- Telling a story from another person's experience as if it were their own.
- Telling a story that took place years ago when a recent one exists.
- Using jargon the interviewer may not know. Explain terms in plain words.

## Output

Each story in the four-part form with a title, a one-line version, the question types it covers and the facts to check. Keep the voice plain and first person.
