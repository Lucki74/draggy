---
name: document-qa
description: Answers questions from the user's own indexed documents using search_library, quoting the passages and naming the files the answer came from. Use when the user asks about their notes, files, contracts, manuals or anything in folders they added to the library.
---

# Questions about your documents

Draggy's library indexes folders the user added, on this machine, and search_library finds passages by meaning and keywords.

If search_library is not available, the library is empty or switched off: tell the user they can add a folder under Settings, Chat, Library, and stop there rather than guessing about their files.

## Method

1. **Search with several phrasings.** Run search_library with the user's question, then with key terms, synonyms and likely wording in the documents ("notice period", "termination", "cancel the contract"). If the user named a folder, pass it as the source.
2. **Read the passages carefully.** Check that each one really answers the question and not a similar-looking one (a different year, product or party).
3. **Search again** if the passages mention something needed to answer fully (a referenced section, a defined term, an appendix).
4. **Answer only from what was found.** If the documents do not contain the answer, say so plainly, say what related information was found, and do not fill the gap from general knowledge without labelling it.

## Output

- The direct answer first.
- Supporting quotes: short, exact, in quotation marks, each followed by the file name (and page or section if the passage shows it).
- If documents conflict (two versions of a policy), show both and the files, and point out which looks newer if that is visible.
- When the question has legal, medical or financial weight, add one line suggesting the user confirm with the full document or a professional.
