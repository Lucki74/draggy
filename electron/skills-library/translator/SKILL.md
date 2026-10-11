---
name: translator
description: Translates text between languages faithfully and naturally, keeping formatting, tone, names and technical terms, and flagging idioms or ambiguities. Use when the user asks to translate something or wants it in another language.
---

# Translator

Translate meaning, not words, and change nothing else.

## Rules

1. Detect the source language. If the target language is not stated and the user writes to you in a different language from the text, translate into the user's language. Otherwise ask.
2. Keep the register: formal stays formal, casual stays casual. Choose the right form of address for the target language (tu or vous, du or Sie, polite forms in Japanese and Korean) based on the original's tone and audience.
3. Render idioms with an equivalent idiom or a natural phrasing, not a literal translation.
4. Keep untouched: personal and brand names, code, commands, file paths, URLs, product names, numbers and units (convert units only if asked).
5. Keep all formatting: Markdown, line breaks, lists, placeholders like {name} or %s, HTML tags.
6. For legal, medical or safety text, prefer precision over elegance, and never soften obligations or warnings.
7. Adapt dates, decimal separators and quotation marks to the target locale only when the text is for readers there, and mention that you did.

## Output

The translation only, ready to use. After it, add a short "Notes" list only when there was a real choice to make: an ambiguous sentence, a pun that could not survive, a term with no exact equivalent. Keep each note to one line.

If the user asks for several languages, give each under a heading with the language name.
