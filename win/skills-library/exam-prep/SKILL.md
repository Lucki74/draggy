---
name: exam-prep
description: Builds a revision plan for a dated exam from its syllabus, weights topics by marks and weakness, schedules active recall and timed mocks, and sets the routine for the last week. Use when the user says they have an exam coming, asks how to revise, or wants a plan for a test.
---

# Exam prep

## Goal

Get the user ready for one specific exam with the days they have. The plan spends time where marks and weaknesses are, uses recall practice over rereading, and finishes with timed practice under exam conditions.

## When to use

- The user names an exam, a date and a syllabus or past papers.
- The user is anxious about where to start.
- The user only needs practice questions: use `use_skill` with `practice-problems`.
- The user wants a general long-term plan with no exam date: use `study-plan`.

## Steps

1. **Collect the facts.** Use `ask_user` for the exam date, format, length, allowed materials, syllabus, past papers and hours available per day. Read supplied files with `read_file`.
2. **List topics with weights.** From the syllabus or past papers, write each topic with its approximate share of marks. Count how often each appears in past papers.
3. **Rate confidence.** Ask the user to rate each topic 1 to 5 from honest recall, not from how much they read. A short test of three questions per topic gives better data than feelings.
4. **Compute priority.** High weight with low confidence goes first. High weight with high confidence gets maintenance. Low weight and low confidence is last.
5. **Build the calendar.** Count the days left and subtract rest days and fixed commitments. Use `update_plan` to record blocks of 45 to 60 minutes with one topic each and a break between.
6. **Choose methods per block.** Recall from a blank page, past-paper questions, explaining aloud, and error review. Reserve rereading for the first pass over a topic only.
7. **Schedule mocks.** Put a full timed paper at about one third, two thirds and a few days before the date. Use real past papers if they exist.
8. **Plan the error loop.** After each mock, list every lost mark by cause (knowledge, method, time, misread) and feed it into the next blocks.
9. **Plan the last week.** Lighten new material, rehearse weak points, check logistics (place, time, equipment), and fix sleep.
10. **Save and revisit.** Create the plan with `create_file` and agree on a check-in after the first mock to adjust.
11. **Plan the exam itself.** Write a time budget per question or section, and a rule for skipping a stuck question and returning to it.

## Gotchas

- Equal time per topic feels fair and wastes marks. Weight by marks and weakness.
- Highlighting and rereading give a sense of progress without recall. Make each block end with something the user produces from memory.
- Mocks done untimed or open book measure little. Keep the real conditions.
- Cramming new topics the night before lowers recall of old ones. Reserve the last evening for light review.
- Exam format differs from course work. Practise the question style, including how marks are awarded.
- Do not promise a grade. Say what the plan covers and what is left at risk.
- Study groups help with explaining and hurt when they become chat. Give each session a list of questions.

## Output

The priority table, the calendar in dated blocks, the mock dates, and the last week routine. Keep text short, and put the plan file path at the end.
