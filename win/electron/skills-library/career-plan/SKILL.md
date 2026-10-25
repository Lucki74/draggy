---
name: career-plan
description: Helps the user clarify what they want from work, map options and build a short plan with skills to grow, people to talk to and dated checkpoints. Use when the user asks for help planning a career, where their career should go, or what skills to build next.
---

# Career plan

## Goal

Move the user from a vague wish to a plan covering the next one to three years. It rests on the daily work they enjoy, what they are good at, what the market offers, and small steps with dates.

## When to use

- The user is stuck, bored, changing fields or choosing between paths.
- The user wants to know which skills to build.
- Reviewing the public profile is `use_skill` with `linkedin-profile-review`.

## Steps

1. Ask with `ask_user` about the present: role, tenure, what they like and dislike in a normal week, and what energy they have left at the end of the day.
2. Ask about the past: the three projects they were proudest of and what made them so. Look for patterns in the tasks, not the titles.
3. Ask about constraints: income needs, location, family, time for study, and how much risk is acceptable. Take them as given and do not argue with them.
4. Ask for a picture of a good workday three years from now. Write it down in the user's words.
5. List three to five paths that could lead there, including staying and growing in the current role. Describe each by the daily work, not the title.
6. Research each path with `search_web` and `read_url`: typical duties, entry routes, and demand in the user's region. Cite sources with dates and do not state pay or job counts from memory.
7. For each path, list the skills the user already has, the skills to add and the proof that would show them, such as a project or certificate. Check what a certificate actually requires before suggesting it.
8. Rank the paths against the user's own priorities and pick one to test first, with a small experiment such as a side project, a short course or a shadowing chat.
9. Name the people to talk to: five conversations with people in the target path, with a question list. Offer `use_skill` with `networking-message` for the outreach.
10. Set checkpoints at one, three and twelve months, each with a clear sign of progress and a date.
11. Agree on a review date, and what would make the user change course.
12. Write the next three actions with dates at the top of the plan so that the first step happens this week.

## Gotchas

- Plans built on job titles instead of daily work.
- Ignoring what the user dislikes, then repeating it in a new role.
- Goals with no checkpoint date.
- Taking one article's view of the market as fact.
- Starting several courses at once and finishing none.
- Treating the plan as fixed when new facts appear.
- Giving a guarantee about outcomes in any field.
- Choosing a path only for the pay, then finding the daily work unbearable.

## Output

A one-page plan: the goal in the user's words, the chosen path with alternatives, skills and proof, people to contact, checkpoints with dates and the review date.
