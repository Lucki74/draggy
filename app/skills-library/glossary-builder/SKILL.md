---
name: glossary-builder
description: Extracts the key terms from a text, course or project and writes a glossary in plain language, with one example per term, the context where the term is used, and links between related terms. Use when the user asks for a glossary, a list of key terms with definitions, or help learning the vocabulary of a subject.
---

# Glossary builder

## Goal

Give the user a reference of the terms they need to read and talk in a field. Each entry says what the term means in this material, shows it in use, and points to the terms it connects to. Definitions are checked, not guessed.

## When to use

- The user starts a new subject or a long text and meets unfamiliar vocabulary.
- A team or course needs a shared list of terms.
- The user wants the terms as study cards: use `use_skill` with `flashcards`.
- The user wants one idea explained in depth: use `explain-concept`.

## Steps

1. **Scope the glossary.** Use `ask_user` for the subject or files, the reader's level, how many terms are wanted, and the format (Markdown list, table, CSV).
2. **Read the source.** Use `read_file` or `read_url`. Mark terms that are specialised, used with a special sense, abbreviated or repeated often. Skip common words.
3. **Rank the terms.** Keep those a reader needs to understand the material. Cut rare or minor terms, or move them to a short "also appears" list.
4. **Define from the source first.** Where the text defines the term, use its meaning in your own words. If it does not, check a reliable source with `search_web` and `read_url`, and note it.
5. **Write each entry.** Pattern: term, short plain definition in one sentence (not using the term itself), one example from or like the source, and a note on common confusion if any.
6. **Handle multiple senses.** If a term has several meanings across fields, give the one used here and say that others exist.
7. **Link terms.** Add "see also" for related or opposite terms, and order entries so that a term comes after the ones it relies on where possible.
8. **Check abbreviations.** Spell out every acronym on first use, and list it with its expansion. Check unusual ones with `search_web`.
9. **Sort and format.** Alphabetical order suits lookup. Group by theme if the user will read it through. Save with `create_file`.
10. **Review with the user.** Ask which terms were missing or unclear and add them.
11. **Plan upkeep.** Add a line for new terms and agree who updates the glossary when the material grows.

## Gotchas

- Circular definitions ("a hash is the result of hashing") teach nothing. Define by what the thing is and does.
- A dictionary sense can differ from the field's sense. "Significant", "model" and "function" mean different things in different fields.
- Examples must be true to the field. A wrong example is worse than none.
- Too many terms make a glossary nobody opens. Keep the core list short and complete.
- Terms change by region and community. State the usage you followed.
- Do not copy definitions from a copyrighted glossary. Write your own and cite for facts only.
- Standards bodies and laws define terms formally. When a term has an official definition, quote the source and its date.

## Output

The glossary as a Markdown list or table with term, definition, example and see-also. Add a one-line note stating the source material and the date.
