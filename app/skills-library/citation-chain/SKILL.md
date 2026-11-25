---
name: citation-chain
description: Starts from one seed paper and walks its references backward and the works citing it forward, to map the surrounding literature, find the foundational and the newest work and spot corrections. Use when the user asks who cites a paper, what a paper builds on, or how to expand from one good paper to a reading list.
---

# Citation chain

## Goal

Turn one known paper into a map of its field: the works it rests on, the works that respond to it, and the papers that matter most in between. The user ends with a short, ranked reading list and a sense of where the debate stands.

## When to use

- The user has one good paper and wants more like it.
- The user needs to see how a finding was received or challenged.
- For a full review across many papers, use `use_skill` with `literature-review`. For one paper's summary, use `summarize-paper`.

## Steps

1. **Identify the seed exactly.** Get title, authors, year and DOI. Use `search_web` to confirm the right record, since titles repeat. Ask with `ask_user` if more than one paper fits.
2. **Read the seed.** Use `read_url` on the paper or its landing page. Note the question and the claims that others would cite.
3. **Go backward.** Read the reference list. Mark the items cited for method, for data and for the central claim. Open the three or four most cited inside the text.
4. **Go forward.** Use `search_web` for the title with "cited by", and for open indexes of citations. Collect the most recent works and any that cite the seed in the abstract.
5. **Look for responses.** Search the seed's title with words like comment, reply, replication, correction, retraction. Open any hit.
6. **Find the overlap.** Papers that appear in both the backward list of the newest work and the forward list of the oldest are the core of the field.
7. **Rank.** Choose 8 to 12 papers. Tag each as foundation, method, challenge, replication or recent review. State why each earns a slot.
8. **Log the route.** Keep the queries and indexes used so the user can repeat the walk.
9. **Add one outsider.** Search for a paper on the same question that does not cite the seed, to test whether the map is closed on itself.
10. **Note open questions.** List what the cluster does not yet answer, since that is where the user can add something.

## Gotchas

- Citation counts measure attention. A paper cited often because it is wrong still has a high count. Check how it is cited.
- Citation indexes differ in coverage and disagree on counts. Name which one you used and do not compare numbers across indexes.
- A retracted paper stays in reference lists. Check the publisher page and the retraction notice for every seed and every core paper.
- Preprints and the published version can differ. Cite the version you read and say whether a final version exists.
- Reviews cite selectively. Do not take a review's reference list as the whole field.
- Papers from the last year have almost no citations yet. Include recent ones by date, not by count.
- Self-citation inflates a cluster. Check if the forward list is mostly the same authors.
- Review articles dominate citation lists but add no new evidence. Keep them as entry points and read the studies they cite.
- Titles repeat across years with changed content. Match DOI before listing.

## Output

A ranked list of papers with year, a one-line role tag and why it is included, grouped as foundations, challenges and recent work. Add the route taken in two lines, and flag any retraction or correction found.
