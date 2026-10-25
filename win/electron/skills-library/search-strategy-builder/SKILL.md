---
name: search-strategy-builder
description: Designs a repeatable search plan for a research question, with concept blocks, synonym lists, source choices, filters, inclusion rules and a log of every query run. Use when the user asks how to search for something systematically, what to search for, or needs a search plan they can document.
---

# Search strategy builder

## Goal

Turn a vague topic into a written plan that another person could rerun and get the same results. The plan lists concepts, terms, places to search, limits and the rules for what counts as relevant, fixed before the results are seen.

## When to use

- A thesis, review, report or due diligence needs documented searching.
- A plain search keeps returning the same few pages and the user needs a wider net.
- To run the full investigation after the plan exists, use `use_skill` with `deep-research`. For academic review writing, use `literature-review`.

## Steps

1. **Frame the question.** Write it in one sentence. For clinical-style or evidence questions split it into population, intervention or topic, comparison and outcome. For others, list the two to four ideas that must all be present.
2. **Set the inclusion rules.** Before searching, decide with the user: dates, languages, regions, document types and minimum quality. Use `ask_user` for any not stated, and write them down.
3. **Make concept blocks.** For each idea, list synonyms, related terms, spelling variants, acronyms and older names. Include terms used by practitioners and by academics, since they differ.
4. **Combine.** Join terms within a block with OR and blocks with AND. Plan exact phrases in quotes only for stable terms.
5. **Choose where to search.** Pick general web, scholarly indexes, government and standards sites, preprint servers, news archives and specialist forums. Use `search_web` to discover which databases cover the field.
6. **Run a pilot.** Try the main string in one place. Read the first 20 results. Note useful new terms and noise terms, and adjust the blocks.
7. **Run and log.** For each query record date, place, exact string, filters and number of results. Keep this in a table. Use `create_file` for the log.
8. **Screen.** Apply the inclusion rules to titles first, then to full text. Record the reason for each exclusion.
9. **Chase leads.** Check the references of the best items, and search for newer work that cites them.
10. **Test recall.** Pick three papers or pages you already know are relevant and confirm the strings find them. If not, add terms.
11. **Freeze and date.** Save the final plan with the date so later reruns are comparable.

## Gotchas

- Rules written after looking at results bend toward what you hoped to find. Fix them first.
- One string does not travel. Each search tool has its own syntax, field names and wildcards. Rewrite per tool.
- Terms change by field and decade. Include the older name or you miss early work.
- Search engines personalise and drift. Log the date, and do not claim a count as final.
- Searching only English biases the picture. State the language limit if you keep it.
- Too many AND blocks return nothing, too few return noise. Adjust one block at a time.
- Grey literature (reports, theses, standards) is missed by article indexes. Add a separate pass for it.
- Stop rules need writing down. Say how many pages or how many empty results end a search.

## Output

A one-page plan: question, inclusion rules, concept table with terms, final strings per source, and an empty or filled log. Mark which parts were run and which are still planned.
