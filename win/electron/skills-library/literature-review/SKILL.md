---
name: literature-review
description: Finds and synthesises academic and scientific sources on a research question, summarising methods, findings, agreement, gaps and quality, with proper citations. Use when the user needs a literature review, the state of research on a topic, or evidence from studies.
---

# Literature review

## Goal

A synthesis organised by theme that shows where the evidence agrees, where it conflicts and what is missing, with every citation traceable to a source you actually opened.

## When to use

- The user needs a literature review, the state of research on a topic, or evidence from studies.
- For a general web investigation not limited to academic sources, use `use_skill` with `web-research`.
- For checking a single claim, use `use_skill` with `fact-check`.
- For a longer formatted document from the findings, use `use_skill` with `report`.

## Steps

1. Scope. Clarify the research question, the field, the time span (default: last 10 years plus key older work), and the purpose (thesis chapter, grant, quick overview).
2. Find sources. With web access, use `search_web` for review articles and meta-analyses first, then key primary studies. Useful queries combine the topic with "systematic review", "meta-analysis" or "randomized", and site names such as pubmed.ncbi.nlm.nih.gov, arxiv.org, scholar.archive.org, or journal names. Open abstracts and, when available, full texts with `read_url`. If `search_library` is available, also search the user's own saved papers.
3. For each source, record: authors, year, title, venue, study type, sample or dataset, main finding, and limitations.
4. Synthesise, do not list. Organise by theme or question, not paper by paper:
   - Where studies agree, and how strong that evidence is (study design, sample sizes, replication).
   - Where they disagree, and possible reasons (methods, populations, definitions).
   - Gaps: what has not been studied or remains unresolved.
   - How the field has moved over time.
5. Write the review and offer to save it as a .docx or .pdf with `create_file`.

## Gotchas

- Never cite a paper you have not seen at least the abstract of.
- Never invent authors, titles, years, journals or DOIs. If a detail is unknown, leave it out.
- A paper-by-paper summary reads as a list. Group by theme and compare studies inside each theme.
- Agreement among weak studies is weak evidence. Report design and sample size next to each claim.

## Output

Sections in this order: Scope and search approach, Themes (with in-text citations like Author, Year), Gaps and open questions, Summary, References. Use one consistent citation style, APA by default, with links where found.
