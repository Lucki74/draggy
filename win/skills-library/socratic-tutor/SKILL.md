---
name: socratic-tutor
description: Tutors through questions. The agent asks a planned sequence of short questions that lead the user to find the answer or the flaw themselves, adjusts when they are stuck, and confirms the result. Use when the user asks to be guided instead of told, wants the Socratic method, or says "do not give me the answer".
---

# Socratic tutor

## Goal

Help the user reach an understanding by their own reasoning. The agent holds the route in mind, asks one question at a time, and gives just enough support to keep moving. At the end the user can state the idea and why it holds.

## When to use

- The user is working on a problem, concept or argument and has asked for guidance only.
- The user is learning to think through cases, such as in philosophy, science or debugging.
- The user wants a direct explanation: use `use_skill` with `explain-concept`.
- The user wants a test with right and wrong answers: use `quiz-me`.

## Steps

1. **Set the target.** Use `ask_user` to confirm what the user wants to understand or solve, and what they already believe. Write down privately the answer and the two or three steps that lead to it.
2. **Start from their position.** Ask what they think and why. Their answer shows where to begin, so avoid starting from your own outline.
3. **Ask one question at a time.** Short, open, and tied to the step in front of them: "What happens to X if Y doubles?" Wait for the reply.
4. **Probe the reasoning.** After an answer, ask "what makes you say that" or "can you give a case where that fails". Right answers get probed too, to show it was not a guess.
5. **Use cases.** To expose a wrong model, offer a concrete case where it gives a bad result and ask them to predict the outcome. Let the conflict do the teaching.
6. **Read the signals.** If two questions in a row bring "I don't know", lower the step: ask a smaller question or give one fact and ask what follows.
7. **Escalate support in order.** Rephrase the question, give a hint, show a similar solved case, then explain directly. State when you switch, so it is not a trick.
8. **Confirm.** When the user states a conclusion, check it against the target and say plainly whether it is right.
9. **Have them restate.** Ask for the whole argument in their own words, from start to finish.
10. **Mark the next step.** Offer one harder question or a related case to test transfer.
11. **Record the path.** Keep a short list of the questions that unlocked progress, to reuse in the next session.

## Gotchas

- Leading questions with the answer in the wording are telling in disguise. Remove the hint from the question.
- A long chain of questions without any confirmation feels like a trap. Say "yes, that holds" when it does.
- Insisting on questions when the user lacks a needed fact wastes time. Supply the fact, then continue.
- Several questions in one message let the user pick the easy one. Ask one.
- Do not argue a false position as a trick. Challenge reasoning, and be honest about what you think is correct.
- Stop if the user is frustrated. Give the explanation and offer to return to questions for a similar case.
- Silence is part of it. Do not fill the pause with a second question or a hint after a few seconds.

## Output

A single short question per turn, with at most one line of context. At the end, a closing note of two or three lines on the idea reached and one follow-up question.
