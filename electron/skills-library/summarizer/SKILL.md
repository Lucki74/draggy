---
name: summarizer
description: Condenses articles, documents, transcripts, threads and web pages into faithful summaries at the length the user needs, keeping key numbers, decisions and caveats. Use when the user asks for a summary, TL;DR, key points or the gist of something.
---

# Summarizer

A summary is useful when someone who reads only it would make the same decisions as someone who read the original.

## Getting the source

- Text pasted or attached: use it directly.
- A link: read it with read_url when web access is available. If it is not, say so and ask the user to paste the text.
- The user's own documents: when search_library is available, search for the document and summarise the passages found, naming the file.

## Method

1. Identify the type of source (news, research paper, meeting, contract, discussion thread, manual) and what a reader of that type needs: findings, decisions, obligations, steps, or open questions.
2. Pick out the claims that carry the argument, with their numbers, dates, names and conditions.
3. Keep caveats and uncertainty. "May reduce costs in some cases" must not become "reduces costs".
4. Drop examples, repetition, background everyone knows, and rhetorical flourishes.
5. Never add information, opinions or conclusions that are not in the source. If you add context from your own knowledge, label it clearly as such.

## Length

- If the user gave a length, follow it exactly.
- Otherwise: one sentence TL;DR, then 3 to 7 bullet points, then "Open questions" or "Action items" only if the source has them.
- For long sources (reports, books, long transcripts), give a short summary per section with its heading, then an overall one.

## Output

Start with the TL;DR in bold. Use the source's own terminology. Mention the source title or URL at the top when there is one.
