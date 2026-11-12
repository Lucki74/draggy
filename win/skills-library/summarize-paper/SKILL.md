---
name: summarize-paper
description: Summarizes a research paper by reading the full text for its question, method, sample, results and limits, and reports what the data support separately from what the authors claim. Use when the user asks to summarize a paper, explain a study, or say what a research article really found.
---

# Summarize paper

## Goal

Give the user an accurate picture of a study in a page or less: what was asked, what was done, what was found, how sure to be and what it does not show. The abstract is the authors' pitch, so the summary reads past it.

## When to use

- The user shares a paper, preprint or link and wants the gist or a check of a news claim about it.
- For a survey of many papers, use `use_skill` with `literature-review`. To expand from one paper to its neighbours, use `citation-chain`.

## Steps

1. **Get the full text.** Use `read_file` for a local PDF or text, or `read_url` for a page. If only the abstract is open, say so and limit the summary to it.
2. **Identify the paper type.** Experiment, observational study, review, meta-analysis, model, theory or case study. The type sets what it can prove.
3. **Write the question.** One sentence: what did the authors try to find out?
4. **Extract the method.** Who or what was studied, how many, how chosen, over what period, what was measured and how it was compared.
5. **Extract the results.** Note main findings with the actual numbers, effect sizes and uncertainty (intervals, p-values, error bars) as printed. Copy figures exactly.
6. **Read the limits.** Find the limitations section and the discussion. Add any limit you see that the authors skip, such as no control group or a narrow sample.
7. **Separate claim from evidence.** Compare the abstract and conclusion with the results tables. Mark any claim stronger than the data.
8. **Note context.** Check journal, date, funding, conflicts and whether it is peer reviewed. Use `search_web` for a retraction, correction or published replication.
9. **Write the summary** at the level the user wants, in plain words, defining each term once.
10. **Define the jargon.** List the three terms a newcomer would trip on and give each a plain meaning.
11. **Match the level.** Ask if the reader wants a lay version or a methods-heavy version, and adjust length.

## Gotchas

- "Associated with" is not "causes". Keep the study's own verb and say if the design allows causal claims.
- Statistical significance is not size. Report the effect next to the p-value.
- A sample of 40 students does not speak for adults. State who the findings cover.
- Relative risk hides absolute change. Give both if the paper does.
- Preprints are not reviewed. Say so near the top.
- Do not fix numbers you find odd. Quote them, and flag them as odd.
- Figures and tables often carry the real result. Read them and the captions, since the text may round or spin.
- Supplementary files hold the excluded cases and extra tests. Mention if you did not open them.
- Animal, cell and lab results do not transfer to people or to field conditions by default. State the setting.

## Output

Headings in this order: Question, Method, Findings, Limits, What it does not show, Status (peer review, replication). Two to three lines each. Add a one-sentence bottom line. Keep under 350 words unless asked for more.
