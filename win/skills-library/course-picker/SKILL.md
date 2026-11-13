---
name: course-picker
description: Compares courses, books and learning routes against the user's goal, current level, weekly time and budget, checks the live details of each, and recommends one with the reasons and the trade-offs. Use when the user asks which course to take, what is the best way to learn something, or how two courses compare.
---

# Course picker

## Goal

Help the user choose a way to learn that fits their goal and life. The recommendation rests on checked details from the course pages and on what past learners report, and it is honest about what could not be verified.

## When to use

- The user names a skill or subject and asks where or how to start.
- The user has two or three options and cannot decide.
- The user has chosen and needs a stage-by-stage plan: use `use_skill` with `skill-roadmap`.
- The user wants a full study timetable: use `study-plan`.

## Steps

1. **Clarify the goal.** Use `ask_user` for what the user wants to be able to do afterwards (pass a certification, get a job, build a thing, understand a field), the deadline, the current level and the language.
2. **Clarify the limits.** Ask for hours per week, budget, preferred format (video, text, live, project) and any access limits such as no card payments.
3. **Find candidates.** If none are named, use `search_web` for courses, books, free resources and programmes for that goal. Aim for four to six, including at least one free option.
4. **Read the course pages.** Use `read_url` for each: syllabus, prerequisites, length, assessment, price, start dates and instructor background. Prices, dates and availability change, so record the date checked.
5. **Check outcomes.** Look for what graduates produce: projects, certificates and their recognition by employers, or exam pass rates if published. Treat testimonials on the seller's page as marketing.
6. **Read outside opinions.** Search for independent reviews, forum threads and learner write-ups. Look for recurring points on pace, quality and drop-out reasons.
7. **Check fit.** Compare each with the goal, level and time. A course that needs 10 hours weekly fails a 3 hour budget.
8. **Score.** Make a table with goal fit, level fit, time, cost, evidence of quality and risk. Mark unknown cells as unknown.
9. **Recommend.** Give a first choice, a backup and a free starter step the user can try this week to test commitment.
10. **Test before paying.** Find a free lesson, sample chapter or trial for the top two and ask the user to try twenty minutes of each.
11. **Set a review date.** Agree a date to judge progress and a rule for switching if the course is not working.

## Gotchas

- Star ratings reward entertaining courses, not learning. Look for projects, feedback and assessment.
- A certificate is useful only if the person who matters recognises it. Ask what the target employer or body asks for.
- Prerequisites are often listed loosely. Read a sample lesson to judge the real starting level.
- Discount banners restart every week. Quote the normal price and the date seen.
- The best course for a friend may fail for the user because of time or style. Weight their limits over popularity.
- Do not rank courses you could not open. Say you only saw the listing.
- Course completion rates are low everywhere. Pick the option the user will finish, which is often the shorter one.

## Output

A compact comparison table, the recommendation with two or three reasons and one risk, and a first step. State the date prices and dates were checked.
