---
name: resume-tailor
description: Reorders and rewords an existing resume to match a job posting using only experience the user really has, and lists the gaps instead of covering them. Use when the user asks to tailor a resume to a job, adapt a CV for a posting, or match their resume to a job ad.
---

# Resume tailor

## Goal

Produce a version of the user's resume that puts the most relevant true experience first and uses the posting's own words where they honestly apply. Where the user lacks something the posting asks for, the skill says so and never invents it.

## When to use

- The user has a resume and a specific posting.
- The user applies to several similar roles and wants a version for each.
- Building a first resume from nothing is `use_skill` with `resume`.
- A matching letter is `use_skill` with `cover-letter`.

## Steps

1. Read the resume with `read_file` and the posting with `read_file` or `read_url`. Ask with `ask_user` for the role the user wants, if the posting is long or lists several.
2. Extract from the posting: the five to eight must-have skills and duties, the tools named, and the words the employer uses for the work. Separate requirements from nice-to-haves.
3. Build a match table: each requirement, the resume line that supports it, and a rating of strong, partial or none. Show it to the user.
4. For every partial or none, ask the user whether they have relevant experience that is missing from the resume. Add it only if they confirm it and can speak to it in an interview.
5. Reorder: move the strongest matching roles, projects and skills toward the top of each section. Keep dates and titles exactly as they are.
6. Reword bullets to mirror the posting's vocabulary only where the meaning is the same. Keep each bullet to action, scope and result, with a number when the user can verify one.
7. Rewrite the summary in two or three lines aimed at this role, built from facts in the resume.
8. Cut or shorten lines that do not help for this role, without hiding employment periods.
9. Check that every claim traces to the original resume or to something the user confirmed.
10. Save the new version with `create_file` under a name that includes the company and role. Keep the original untouched.
11. Re-read the final file against the posting once more and list any requirement still unmet, so the user can speak to it honestly.

## Gotchas

- Adding a skill or tool because the posting lists it. If the user cannot discuss it, it will hurt them in the interview.
- Stuffing keywords. A parsing tool may like it, and the human reader will not.
- Removing dates, titles or a short job to hide a gap. Handle gaps honestly in the summary or the letter.
- Changing job titles to match the posting.
- Inflating numbers or scope in a bullet while rewording it.
- Tailoring so far that the resume contradicts the user's public profile.
- Sending a file that still names the previous company.
- Keeping a skills line the user has never used at work. Move it to a learning note or cut it.

## Output

The match table with ratings, the tailored resume, a short list of changes made and a list of gaps the user should be ready to address. Say which lines are new wording of the same facts.
