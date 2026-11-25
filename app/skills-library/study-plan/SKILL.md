---
name: study-plan
description: Builds a realistic study or learning plan toward an exam, certification or skill, with weekly goals, spaced review, practice tests and a calendar-friendly schedule. Use when the user wants to plan studying, prepare for an exam, or learn a skill by a date.
---

# Study plan

## Goal

Turn a goal and a deadline into a schedule the user can actually follow, with weekly targets, spaced review and practice tests, and a way to tell whether each week worked.

## When to use

- The user wants to plan studying for an exam or certification.
- The user wants to learn a skill by a date ("conversational Spanish in 6 months").
- For making flashcards or quizzing the user on the material, use `use_skill` with `flashcards` or `quiz-me`.

## Steps

1. Collect the inputs: goal and deadline, current level and what is already covered, time available per day or week and days that are off, and materials (syllabus, textbook chapters, course modules, past papers). Ask for anything essential that is missing, in one message.
2. Work backwards from the deadline. The final 10 to 15% of the time is for review and full practice tests.
3. List topics with estimated effort in hours and weight in the exam.
4. Allocate topics to weeks. Put hardest or most heavily weighted topics earlier, when there is time to struggle. Interleave topics once the basics are in place instead of studying one topic in blocks.
5. Schedule spaced repetition: revisit each topic roughly 1 day, 1 week and 3 weeks after first learning it.
6. Make each week use active recall over rereading: practice questions, flashcards or explaining topics aloud.
7. Plan for about 80% of the time available and leave buffer days for slippage.
8. For each week, write goals ("finish chapters 4 and 5; 30 practice questions on 1 to 3") and a checkpoint that shows whether the week succeeded.
9. Add milestones such as mock exam dates.

## Gotchas

- A plan that uses 100% of stated time breaks on the first sick day. Keep buffer.
- Rereading feels productive and tests poorly. Every week needs retrieval practice.
- Saving the hard topics for last leaves no time to recover from not understanding them.
- Without a checkpoint per week, falling behind goes unnoticed until the final stretch.
- Topic weights guessed without a syllabus can mislead. Say when you are estimating.

## Output

A weekly overview, then a day-by-day table for the first two weeks. Offer to save the whole plan as an .xlsx with `create_file` (columns: Date, Topic, Task, Minutes, Done, see `use_skill` with `xlsx`), and to adjust it when the user falls behind.
