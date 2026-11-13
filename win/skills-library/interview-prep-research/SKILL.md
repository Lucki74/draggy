---
name: interview-prep-research
description: Builds a short briefing on a company or a professional from public sources before a job interview, sales call, meeting or press interview, ending with sharp questions to ask. Use when the user asks to research a company or person before meeting them, or to prepare for an interview with background facts.
---

# Interview prep research

## Goal

Equip the user to walk into a conversation informed: what the organisation or person does, what happened recently, what matters to them and what to ask. All facts come from public material and carry a date.

## When to use

- The user has a job interview, a client call or a meeting with a named company or professional.
- The user is the interviewer and wants background on a guest.
- For finding whom to speak to, use `use_skill` with `expert-finder`. For preparing the conversation script itself, use `interview-questions`.

## Steps

1. **Get the context.** Use `ask_user` for the exact name (and city or sector if common), the role the user plays, the date of the meeting and what they want out of it.
2. **Confirm identity.** Use `search_web` and check that the organisation or person found is the right one. Match employer, location or role to what the user said. Ask if two candidates fit.
3. **Read official pages.** Use `read_url` on the company site (about, products, careers, news, leadership) or the person's professional profile and published work.
4. **Read recent news.** Search for the last 12 months: launches, results, hires, partnerships, setbacks. Open at least two independent reports and note dates.
5. **Read what they say themselves.** Look for filings, annual letters, talks, blog posts or interviews. Pull two or three themes they repeat.
6. **Read outside views.** Check customer reviews, trade press and, for employers, public staff feedback. Weigh it as opinion.
7. **Link to the user's goal.** Connect findings to the purpose: for an interview, the needs behind the open role; for a sale, likely priorities; for a guest, topics where they have said something notable.
8. **Draft questions.** Write five to eight specific ones, each tied to a finding. Skip anything the homepage already answers.
9. **Mark uncertain items** so the user does not state them as fact.
10. **Prepare your own pitch.** Tie two points from the research to what the user will say about themselves or their offer.
11. **Plan for surprises.** Note one fact that, if wrong or outdated, would change the opening, and how to ask about it politely.

## Gotchas

- People share names. Verify with two matching details before attributing a post, quote or scandal.
- Stay with professional, public material. Do not dig into family, home, health or private accounts.
- Old pages persist. A leadership page can list someone who left. Check dates and recent news.
- Anonymous staff reviews skew toward extremes. Quote patterns, not single posts.
- Press coverage of funding can be out of date or optimistic. Prefer the company's own statements or filings for figures.
- Do not guess salary, plans or internal matters. If unknown, make it a question to ask.
- Quoting a person's obscure old post back at them lands badly. Use public work they would expect you to know.
- Acquisitions and renames split a company's history across names. Search the former names too.

## Output

A one-page brief: who they are, recent developments with dates, their stated priorities, what to be careful about, and the list of questions. Sources as links at the bottom. Keep it scannable.
