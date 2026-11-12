---
name: cover-letter
description: Writes tailored cover letters that connect the candidate's real experience to a specific job posting, in under a page. Use when the user wants a cover letter or motivation letter for a job, internship or programme.
---

# Cover letter

## Goal

A cover letter answers one question: why this person, for this role, at this organisation. A good result is a letter of about 300 to 400 words that ties the posting's main requirements to concrete evidence from the candidate's own history.

## When to use

- The user wants a cover letter or motivation letter for a job, internship or programme.
- The user has a posting and a CV and wants them matched.
- For a CV rewrite or a general email, this skill does not apply.

## Steps

1. Gather the inputs. You need the job posting (pasted, attached, or a link to read with `read_url`) and the candidate's experience (a CV, LinkedIn text or a description). If either is missing, ask with `ask_user`.
2. From the posting, extract the 3 to 5 requirements that matter most, including any stated values or problems the team is solving.
3. From the candidate's material, find the strongest evidence for each: a project, a result with a number, a responsibility.
4. Pick the two or three best matches. Depth beats covering everything.
5. Find something specific about the organisation, from the posting or its website if web access is available (`read_url`, `search_web`), to show genuine interest.
6. Write the letter in this shape:
   - **Opening:** the role, and a one-sentence reason the candidate is a strong fit.
   - **Two body paragraphs:** each links a requirement to concrete evidence, ideally with a result.
   - **Why them:** what draws the candidate to this organisation specifically.
   - **Close:** enthusiasm for a conversation, and thanks.
7. Match the formality of the industry and the language of the posting. Use the hiring manager's name if the posting gives it, otherwise "Dear Hiring Team".

## Gotchas

- Never invent jobs, degrees, skills, numbers or achievements. Use only what the candidate supplied.
- "I am writing to apply for" wastes the opening. Start with the role and the fit.
- A letter that repeats the CV adds nothing. Choose a few items and give them depth.
- Generic praise for the organisation could be sent to anyone. Use a detail from the posting or the site.
- Going past a page loses the reader.

## Output

The letter, ready to paste. If the user wants a file, save it with `create_file` as a .docx. Then list any placeholders to fill in and any requirement from the posting that the letter could not support with evidence.
