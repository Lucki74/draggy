---
name: summarizer
description: Condenses articles, documents, transcripts, threads and web pages into faithful summaries at the length the user needs, keeping key numbers, decisions and caveats. Use when the user asks for a summary, TL;DR, key points, or the gist of something.
---

# Summarizer

## Goal

Make a summary that lets someone who reads only it reach the same decisions as someone who read the original.

## When to use

- The user asks to summarise, shorten, or give the key points or gist of a text, link, transcript or document.
- For minutes with owners and deadlines from a meeting, use `use_skill` with `meeting-notes`.
- For answering specific questions about a document, use `use_skill` with `document-qa`.

## Steps

1. Get the source. Pasted or attached text: use it directly. A link: open it with `read_url`, and if web access is off, say so and ask the user to paste the text. The user's own documents: use `search_library` to find the document, summarise the passages found, and name the file.
2. Identify the type of source (news, research paper, meeting, contract, discussion thread, manual) and what a reader of that type needs: findings, decisions, obligations, steps, or open questions.
3. Pick out the claims that carry the argument, with their numbers, dates, names and conditions.
4. Keep caveats and uncertainty. "May reduce costs in some cases" must not become "reduces costs".
5. Drop examples, repetition, background everyone knows, and rhetorical flourishes.
6. Add nothing that is not in the source: no opinions, no conclusions. If you add context from your own knowledge, label it as such.
7. Set the length. If the user gave one, follow it exactly. Otherwise write a one-sentence TL;DR, then 3 to 7 bullet points, then "Open questions" or "Action items" only if the source has them. For long sources (reports, books, long transcripts), give a short summary per section with its heading, then an overall one.

## Gotchas

- Dropping a hedge changes the claim. Keep "may", "in some cases" and "preliminary".
- Numbers and dates are the first thing a lazy summary gets wrong. Recheck them against the source.
- A summary drifts toward the model's own framing. Use the source's terminology.
- Summarising a page the fetch only half loaded gives a confident summary of half a document. Check that the text covers the whole piece.
- Exceeding a requested length is a failure, however good the content.

## Output

Start with the TL;DR in bold. Use the source's own terminology. Mention the source title or URL at the top when there is one.
