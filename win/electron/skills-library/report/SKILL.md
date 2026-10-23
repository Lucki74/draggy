---
name: report
description: Writes structured reports (executive summary, findings, analysis, recommendations) from notes, data or research, and saves them as Word or PDF. Use when the user asks for a report, a written analysis, a status update document or a briefing paper.
---

# Report writer

## Goal

A report read top-down by people with little time: the conclusion first, the evidence after, every claim supported. The structure lives in the [template](template.md).

## When to use

- The user asks for a report, written analysis, status update document or briefing paper.
- For slides, use `use_skill` with `pptx`.
- For sourced research on a question without a report format, use `use_skill` with `web-research`.
- For a short summary of one document, use `use_skill` with `summarizer`.

## Steps

1. Pin down purpose and reader: who decides what after reading this? Write for that decision.
2. Gather material. Use what the user provided. If research is needed, use `search_web` and `read_url` and keep a list of sources. If `search_library` is available, check the user's own documents first.
3. Read the template with `use_skill` and file "template.md".
4. Write the findings. Each is a clear statement backed by evidence (a number, a quote, a source). Keep facts and interpretation apart.
5. Write the analysis: what the findings mean, including risks, trade-offs and uncertainty.
6. Write the recommendations: specific, actionable, ranked by importance, each tied to a finding.
7. Write the executive summary last, in 5 to 8 lines: the situation, the key findings, the main recommendation.
8. Use plain language, active voice and short paragraphs. Give numbers units and time periods ("revenue rose 12% year on year in Q3").
9. Ask whether the user wants an editable .docx or a finished .pdf, then save with `create_file`. Use HTML for tables and styled sections.

## Gotchas

- Writing the summary first produces a summary of what you meant to say. Write it last.
- A recommendation with no finding behind it reads as opinion.
- Estimates presented as facts mislead the reader. Mark estimates as estimates.
- Numbers without a unit or period cannot be checked.
- Unsourced claims from web research undermine the whole report. Record each source as you read it.

## Output

The report in the template's structure, saved as the requested file type. Name the file in the reply.
