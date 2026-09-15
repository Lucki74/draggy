---
name: report
description: Writes structured reports (executive summary, findings, analysis, recommendations) from notes, data or research, and saves them as Word or PDF. Use when the user asks for a report, a written analysis, a status update document or a briefing paper.
---

# Report writer

## Shape

Reports are read top-down by people with little time. The structure in template.md (read it with use_skill, file "template.md") puts the conclusion first and the evidence after.

## Method

1. **Purpose and reader:** who decides what after reading this? Write for that decision.
2. **Gather:** use what the user provided. If web access is available and research is needed, use search_web and read_url and keep a list of sources. If search_library is available, check the user's own documents first.
3. **Findings:** each finding is a clear statement backed by evidence (a number, a quote, a source). Separate facts from interpretation.
4. **Analysis:** explain what the findings mean, including risks, trade-offs and uncertainty.
5. **Recommendations:** specific, actionable, ranked by importance, each tied to a finding.
6. **Executive summary last:** write it after everything else, in 5 to 8 lines: the situation, the key findings, the main recommendation.

## Style

- Plain language, active voice, short paragraphs.
- Numbers with units and time periods ("revenue rose 12% year on year in Q3").
- No claims without support. Mark estimates as estimates.

## File

Ask whether the user wants an editable file (.docx with create_file; use HTML for tables and styled sections) or a finished one (.pdf). Mention the file name when done.
