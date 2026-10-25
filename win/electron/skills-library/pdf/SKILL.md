---
name: pdf
description: Creates polished PDF documents with create_file from styled HTML (custom fonts, colors, tables and layouts) or Markdown. Use when the user asks for a PDF, a printable document, a handout or a report to send.
---

# PDF documents

## Goal

A clean PDF the user can read, print or send. Draggy writes .pdf files with `create_file` from either HTML (for styled layouts, custom colors, fonts and precise tables) or Markdown (for fast, clean text documents). Chromium lays out and typesets both.

## When to use

- The user asks for a PDF, a printable document, a handout, or a report to send.
- The document will be read, printed or sent, not edited: reports, handouts, invoices, itineraries, reference sheets.
- If the user needs a file that can be opened and modified in Word, use `use_skill` with `docx` instead.

## Steps

1. Choose HTML when you need specific colors, side-by-side columns, invoices or precise table widths. Choose Markdown for plain text documents.
2. Put one title heading at the top, followed by a subtitle or date. Use clear section headings (`<h2>` or `##`) so the structure holds when printed.
3. Pick a clear filename such as `trip-itinerary-june.pdf` and call `create_file` with the HTML or Markdown content.
4. For HTML, these features are supported:
   - Full styling with inline CSS `style="..."`: font sizes, text colors (`color: #1e293b`), backgrounds (`background-color: #f8fafc`), borders and padding.
   - Tables with custom column widths (`<col width="...">` or `<th style="width: ...">`), header shading, cell alignment, borders and multi-line content.
   - Layouts with flexbox, CSS grids and multi-column designs (`display: flex; justify-content: space-between`).
   - Page breaks with `<div style="page-break-after: always"></div>` before a new section.
   - Images and icons as inline `data:` URIs (`<img src="data:image/png;base64,...">`).
   - A page number (`X / Y`) typeset automatically at the bottom center of each page.
5. For Markdown, these features are supported: headings `#` to `######`, paragraphs, bold, italic, `inline code` and ~~strikethrough~~, bulleted and numbered lists, pipe tables (`| Col 1 | Col 2 |`), fenced code blocks, block quotes and horizontal rules.

## Gotchas

- Remote image URLs are blocked for privacy. Embed images as `data:` URIs or they will not appear.
- Page numbers are added for you. Do not add your own footer numbering or it will double up.
- A section that starts at the bottom of a page looks orphaned. Add a page break before it.
- A PDF cannot be edited easily afterwards. If the user will change it, offer .docx.

## Output

The file name, what it contains in one line, and roughly how long it is. It is saved in Draggy's Created files.
