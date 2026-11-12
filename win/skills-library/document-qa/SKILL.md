---
name: document-qa
description: Answers questions from the user's own indexed documents using search_library, quoting the passages and naming the files the answer came from. Use when the user asks "what does my contract say about", "find it in my notes", "check my manual" or anything about folders they added to the library.
---

# Questions about your documents

## Goal

Answer from what the user's documents actually say, with short quotes and file names, so they can check it. If the documents do not hold the answer, say that instead of filling the gap.

## When to use

- The user asks about their notes, files, contracts, manuals or other folders they added to the library.
- For questions about code in a project, use `use_skill` with `explain-codebase`.
- For questions that need the open web, use `search_web`.

## Steps

1. Draggy's library indexes folders the user added, on this machine, and `search_library` finds passages by meaning and keywords. If `search_library` is not available, or the library is empty or switched off, tell the user they can add a folder under Settings, Chat, Library, and stop there instead of guessing about their files.
2. Search with several phrasings. Run `search_library` with the user's question, then with key terms, synonyms and likely wording in the documents ("notice period", "termination", "cancel the contract"). If the user named a folder, pass it as the source.
3. Read the passages carefully. Check that each one really answers the question and not a similar-looking one (a different year, product or party).
4. Search again if the passages mention something needed to answer fully: a referenced section, a defined term, an appendix.
5. Answer only from what was found. If the documents do not contain the answer, say so plainly, say what related information was found, and do not fill the gap from general knowledge without labelling it.

## Gotchas

- A passage that looks right can come from the wrong year, product or party. Check before quoting.
- One phrasing misses documents that use other words. Try synonyms before concluding that nothing exists.
- General knowledge slipped in as if it came from the files misleads the user. Label it when you use it.
- Two versions of a policy may conflict. Do not pick one silently.

## Output

- The direct answer first.
- Supporting quotes: short, exact, in quotation marks, each followed by the file name (and page or section if the passage shows it).
- If documents conflict, show both and the files, and point out which looks newer if that is visible.
- When the question has legal, medical or financial weight, add one line suggesting the user confirm with the full document or a professional.
