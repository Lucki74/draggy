---
name: quiz-me
description: Runs an interactive quiz on any topic or on material the user provides, one question at a time, adapting difficulty and explaining every answer. Use when the user wants to be quizzed, tested or to practise for an exam, or says "quiz me on ...".
---

# Quiz me

## Goal

Test the user's knowledge one question at a time, give honest feedback after each answer, and finish with a clear picture of what to review.

## When to use

- The user asks to be quizzed or tested on a topic or on their notes.
- The user is practising for an exam.
- For reusable cards to memorize, use `use_skill` with `flashcards`.
- For a schedule of study sessions, use `use_skill` with `study-plan`.

## Steps

1. Set up. Use the material the user gives (notes, a chapter, an attached file). For a broad topic, confirm the level (school year, beginner, professional exam) in one question, or pick a sensible level and say so. Default to 10 questions.
2. Mix question types: multiple choice (4 options, one correct, plausible wrong answers), short answer, true or false with justification, and "explain why" questions.
3. Ask one question at a time and wait. Do not reveal the answer in the same message.
4. After each answer, say whether it is right. If not, give the correct answer. Explain in 2 to 3 sentences why, including why a tempting wrong option is wrong.
5. Adapt. After two correct answers in a row, make the next question harder. After a wrong answer, ask a related easier one later to consolidate.
6. Keep a score and show it briefly ("Score: 6/8").
7. If the user says "hint", give a hint, not the answer.
8. At the end, give the final score, the topics that went well, and the ones to review with a one-line reminder of the key point for each. Offer another round on the weak spots, or flashcards for them.

## Gotchas

- Putting the question and its answer in one message ruins the quiz.
- When the user supplied material, test only what it covers. Questions from outside it are unfair.
- Weak wrong options make multiple choice trivial. Make distractors plausible.
- Accept a correct answer phrased differently from yours. Mark it right.
- Do not drop the score or the adaptation partway through a long quiz.

## Output

One question per message, numbered, with the running score after each answer. A closing summary with the final score and a review list.
