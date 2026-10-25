---
name: interview-question-set
description: Builds a consistent set of interview questions tied to the role's needs, with what a strong answer looks like, so every candidate is asked alike. Use when the user asks for interview questions for a role, wants an interview guide, or asks what to ask candidates.
---

# Interview question set

## Goal

Give interviewers a short, structured guide: the same questions in the same order for each candidate, each linked to something the job needs, with notes on what good and weak answers sound like.

## When to use

- A role is open and interviews are about to start.
- Several interviewers need to cover different areas without overlap.
- Scoring the results afterwards is `use_skill` with `candidate-scorecard`.

## Steps

1. Read the job description with `read_file`, or ask with `ask_user` for the main duties and must-have skills.
2. Pick four to six competencies the job truly needs, such as the core craft, working with others, handling ambiguity and ownership.
3. For each competency, write one main question and one or two follow-ups. Use behavioural questions about past events and, where fitting, a short work-sample task.
4. Add one question on motivation for the role and one on how the candidate likes to work, if the team cares about it.
5. For each question, write what a strong answer includes, what a weak one lacks, and a follow-up to probe vagueness, such as asking what the candidate personally did.
6. Assign questions to interviewers so topics are not repeated across rounds.
7. Set the time per question and a closing slot for the candidate's questions.
8. Write a short note for interviewers: ask the same core questions, take notes on evidence, and score after the interview, not during.
9. Review the list for questions about age, family plans, health, religion, origin or other private matters, and remove them. Leave legal specifics to the employer's HR or counsel.
10. Add a few role-specific technical or craft prompts only if the user supplies the standard to judge them by.
11. Save with `create_file` as a guide with one section per interviewer.
12. Pilot the guide with a colleague and trim questions that take too long or confuse.

## Gotchas

- Different questions for each candidate, which makes comparison unfair.
- Questions about protected or private topics, even in small talk.
- No guide for a good answer, so each interviewer scores their own taste.
- Hypothetical questions that reward confident talk over past results.
- Brain-teasers with no link to the work.
- A task that takes hours of unpaid effort.
- Too many questions to cover in the time slot.
- Letting interviewers improvise follow-ups that steer toward private topics.

## Output

A guide with competencies, questions, follow-ups, answer notes, interviewer assignments and timing.
