---
name: pdf
description: Creates polished PDF documents with create_file from Markdown, including tables, headings, lists and page numbers, for anything meant to be shared or printed rather than edited. Use whenever the user asks for a PDF, a printable document, a handout or a report to send.
---

# PDF documents

Draggy writes .pdf files with create_file. The content is Markdown, laid out by a browser engine and printed, so it supports more than the Word converter.

## What works

- Headings `#` to `######`, paragraphs, bold, italic, `inline code` and ~~strikethrough~~.
- Bulleted and numbered lists, one level deep (indented items are flattened).
- Tables in Markdown pipe syntax with a separator row; headers repeat across pages.
- Fenced code blocks, block quotes (one line each), horizontal rules, and http or https links.
- A page number is added at the foot of every page.

Images, nested lists and custom fonts or colours are not available.

## When to choose PDF

- The document will be read, printed or sent, not edited: reports, handouts, invoices, itineraries, reference sheets.
- It contains tables (the .docx converter cannot keep them).
If the user needs to edit it afterwards, suggest .docx instead.

## Writing it

1. One `#` title at the top, followed by a line with the date or subtitle.
2. Use `##` for sections so the structure is visible when printed.
3. Keep tables narrow: about six columns at most, short cell text, so they fit the page width.
4. Avoid very long unbroken strings (long URLs) in tables.
5. For multi-page documents, put a short summary or table of contents list near the top.
6. Choose a clear filename like trip-itinerary-june.pdf and call create_file with the Markdown content.

## After creating

Give the file name, what it contains in one line, and roughly how long it is. It is saved in Draggy's Created files.
