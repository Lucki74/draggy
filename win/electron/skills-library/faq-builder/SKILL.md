---
name: faq-builder
description: Builds an FAQ from real questions found in support tickets, emails, chats or search queries, merging duplicates, grouping by task, and answering each with the answer in the first sentence. Use when the user asks for an FAQ, a common questions page, or to turn support tickets into help content.
---

# FAQ builder

## Goal

Cut repeat questions by answering the ones people actually ask. A good FAQ uses the asker's wording, orders entries by how often and how urgently they come up, puts the answer first, and links to deeper help where it exists.

## When to use

- A pile of support messages, reviews or chat logs repeats the same questions.
- A product or service launches and needs an FAQ page.
- An existing FAQ is out of date or nobody can find anything in it.
- For a step-by-step procedure that is too long for an FAQ entry, use `use_skill` with `how-to-guide`.

## Steps

1. Collect the source questions. `read_file` or `search_files` through the tickets, emails, chat exports or forum threads the user provides. If there are none, ask with `ask_user` for the ten questions the team answers most. Do not make questions up.
2. Extract each question as a user would phrase it. Strip names and any personal data before they enter the document. Record how many times each appears when counts are available.
3. Merge duplicates. Questions that differ in wording but need the same answer become one entry, titled in the most common wording. Keep a note of alternative phrasings for search.
4. Group into four to eight categories by what the person is trying to do (getting started, billing, account, shipping), not by internal team names. Put the biggest or most urgent group first.
5. Write each answer: first sentence answers directly (yes, no, a figure, a place to click), then the conditions and one example if needed. Keep it under about 100 words; link out for longer procedures.
6. Use facts the user confirmed or documents show. Where an answer depends on policy, price or dates that may change, mark it for the owner to verify and say where the live source is. Check public documentation with `read_url` when it exists.
7. Name the page by the question, in a heading form that reads well and is searchable, and avoid "Q:" labels that add nothing.
8. Add a route out: how to reach a human, with the correct channel and hours supplied by the user.
9. Plan maintenance: mark each entry with an owner or date to review. Save the FAQ with `create_file`.
10. Test findability: pick five source questions and check each can be found from the headings alone.
11. Link each entry to related ones only when the reader's next question is predictable.

## Gotchas

- Inventing questions yields an FAQ about what the company wishes people asked. Mine real ones.
- Answers that open with background ("At our company we value...") bury the answer. Lead with it.
- Two entries that say the same thing in different words make the page look sloppy and confuse search. Merge.
- Policy answers (refunds, deadlines, limits) go stale first. Mark them for review and avoid copying numbers from memory.
- Personal data in ticket text can leak into examples. Anonymise before quoting anything.
- A hundred entries is a knowledge base, not an FAQ. Keep to the questions that matter and link to the rest.
- Questions that are really complaints ("Why is it so slow?") need a factual answer and a path to a fix, not a defence.
- Tone: match how the help team speaks to customers. A cheerful answer to an angry question reads badly.
- Counts from a small sample mislead. If you have twenty tickets, say so, and do not rank by frequency.
- Questions about legal, medical or safety matters should quote the owner's approved wording only.
- An FAQ with a search box needs the question wording in headings. Do not rename them to sound tidier.

## Output

- The FAQ in the requested format, grouped, with entry questions as headings and answers beneath.
- A short table of the source counts for the top questions, when available.
- A list of entries needing verification by an owner, and questions in the source you could not answer from supplied facts.
