---
name: job-posting-analysis
description: Reads a job posting, separates real requirements from wishes, flags vague or worrying points and gives the user a fit summary against their own priorities. Use when the user asks to analyze a job posting, wants to know what an employer really wants, or asks whether to apply to a role.
---

# Job posting analysis

## Goal

Tell the user what a posting asks for, what it leaves out, and how well it fits what they want and can do. The result helps them decide whether to apply and what to stress if they do.

## When to use

- The user pastes a posting or gives a link.
- The user compares two or three postings.
- Adapting a resume to the chosen role is `use_skill` with `resume-tailor`.

## Steps

1. Get the posting text with `read_file` or `read_url`. If the page is empty or needs a sign-in, ask the user to paste it. Save the text with `create_file`, since postings disappear.
2. Ask with `ask_user` for the user's priorities: pay floor, location or remote needs, growth, type of work, and anything they refuse.
3. Split the posting into duties, required skills, preferred skills, tools, and facts about the employer such as team size, location and pay.
4. Mark each requirement as hard or soft. Phrases such as ideal candidate or a plus usually mark soft ones, and years-of-experience figures are often flexible, so say so as an observation and not a rule.
5. Translate vague phrases into the likely daily work. For example, a fast-paced environment could mean tight deadlines or poor planning, so list it as a question for the interview.
6. Note what is missing: pay range, reporting line, team, how success is measured, why the role is open.
7. Note possible concerns without accusing: a very long list of unrelated duties, several jobs in one, or unclear pay. Phrase each as a question to ask.
8. Compare with the user's resume if provided and rate fit for each hard requirement as strong, partial or none.
9. Check the employer with `search_web`, such as its size, recent news and public reviews. Treat reviews as one signal, and name the date and source.
10. Give a recommendation of apply, apply with a stretch note, or skip, with the reasons tied to the user's own priorities.
11. List the questions to ask the recruiter and the points to stress in the application.
12. Record the posting date, the source link and the closing date in the saved note so the user can track it later.

## Gotchas

- Treating every bullet as a hard requirement. Many hires meet only part of the list.
- Reading a missing pay range as a detail to skip. Ask early.
- Judging fit from the title, which differs between employers.
- Trusting one review site's score. Check several and the dates.
- Dropping the user's priorities in favour of what sounds like a good job.
- Assuming the posting is current. Check the posted date and whether it is still open.
- Repeating the posting's own phrases back as insight.
- Skipping the recruiter's own words in the posting about the process. Steps and timing are facts to record.

## Output

A one-page summary: the role in plain words, hard and soft requirements, gaps in the posting, fit ratings, concerns phrased as questions, and a recommendation.
