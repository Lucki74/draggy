---
name: job-description-writer
description: Turns a hiring manager's notes into a plain job description with real duties, must-haves, nice-to-haves and an honest picture of the role. Use when the user asks to write a job description, draft a job ad, or says they are hiring for a new role.
---

# Job description writer

## Goal

Produce a job description that a good candidate can read in two minutes and understand: what the work is, what is required, what the employer offers, and how to apply. It describes the job as it is, not as it would look best.

## When to use

- A manager has notes, an old posting, or only a title.
- A role has changed and the old ad is out of date.
- Building the interview plan afterwards is `use_skill` with `interview-question-set`.

## Steps

1. Ask with `ask_user` for the title, the team, who the role reports to, the location or remote policy, the type of contract, and the start date.
2. Ask what the person will do in the first three months and in a typical week. Ask what a good first year looks like.
3. Read any existing description or notes with `read_file`. Pull out duties, and drop boilerplate and old tool names.
4. Separate must-haves from nice-to-haves. Limit must-haves to the five or six things a person truly cannot do the job without, and ask the manager to confirm each.
5. Ask about pay, benefits, working hours and growth. Put in any pay range the user supplies. If pay will be left out, say so to the user as a choice with a cost.
6. Write the opening in two or three sentences on the team and why the role exists.
7. Write the duties as five to eight bullets that start with a verb and describe real work.
8. Write requirements in plain words, naming years of experience only when the manager can justify the number.
9. Add a short section on how the team works and the hiring steps, so candidates know what to expect.
10. Check wording for terms that put off qualified people, such as rock star or ninja, and for unneeded gendered or age-coded phrases. Use neutral titles.
11. Add the application instructions and a contact. Ask whether an equal opportunity line is required by the employer, and use their approved text.
12. Read the final text aloud as a candidate would, and cut any sentence that does not help someone decide whether to apply.

## Gotchas

- A list of twelve must-haves that nobody meets.
- Hiding pay or location details the user has.
- Inflated language for ordinary duties.
- Degree or years requirements copied from an old ad.
- Mixing two jobs into one ad because the budget allows one hire.
- Leaving legal wording to guesswork. Ask the employer's HR or counsel for required statements.
- A tone that describes the company's wishes but not the candidate's day.
- Copying a competitor's ad closely.

## Output

The finished description in the order of summary, duties, requirements, nice-to-haves, what we offer, process and how to apply, plus a short list of open questions for the manager.
