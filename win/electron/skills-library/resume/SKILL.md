---
name: resume
description: Builds and improves CVs and résumés with achievement-focused bullet points, a clear layout, tailoring to a target role, and a Word or PDF file. Use when the user wants a CV or résumé written, reviewed, tailored to a job posting or turned into a document.
---

# Résumé / CV

## Goal

A CV that a recruiter can skim in seconds: the most relevant and impressive information first, bullets that show results, and nothing invented. The layout is in the [template](template.md).

## When to use

- The user wants a CV or résumé written, reviewed, tailored or exported.
- For the accompanying letter, use `use_skill` with `cover-letter`.
- For a Word file only, with no writing help, use `use_skill` with `docx`.

## Steps

1. Collect the target role (or posting), work history with dates, education, skills, languages, certifications and notable projects. Ask for what is missing.
2. Write a two to three line profile aimed at the target role.
3. For each role write 3 to 5 achievement bullets, most relevant first. Older roles get fewer. Use action verb, what you did, then the result, with a number where honest. "Cut monthly reporting time from 3 days to 4 hours by automating exports" beats "Responsible for reports".
4. Tailor to the role by mirroring the posting's key terms where they truthfully apply.
5. Group skills sensibly (for example "Languages", "Tools", "Methods"). Leave out skills nobody would question.
6. Read the template with `use_skill` and file "template.md" and follow its structure.
7. Adapt conventions to the country. Photos, birth dates and marital status are expected in some places and inappropriate in others. Ask if unsure.
8. Keep to one page for under about ten years of experience, two pages at most otherwise. Academic CVs can run longer.

## Gotchas

- Never invent experience, titles, dates, qualifications or numbers. If a result has no number, describe its scale or effect in words.
- Bullets that list duties instead of results are the most common weakness.
- Copying a posting's wording for skills the user lacks creates a problem at interview.
- Country conventions differ, and a wrong guess about photos or personal details can hurt.
- A gap in dates draws attention. Flag it to the user rather than hiding it.

## Output

Show the CV in Markdown first. If the user wants a file, save it with `create_file`: .docx for editing or .pdf for sending. In the reply, note anything weak (gaps, vague bullets) and one or two questions whose answers would make it stronger.
