---
name: pdf
description: Creates polished PDF documents with create_file from styled HTML (for custom fonts, colors, tables and layouts) or Markdown. Use whenever the user asks for a PDF, a printable document, a handout or a report to send.
---

# PDF documents

Draggy writes .pdf files with create_file from either **HTML** (recommended for styled layouts, custom colors, fonts, and precise table formatting) or **Markdown** (for fast, clean text documents). Both are laid out and typeset by Chromium.

## Writing with HTML (Recommended for styled PDFs)

Pass semantic HTML to create_file:

- **Full styling:** Use inline CSS `style="..."` for custom font sizes, text colors (`color: #1e293b`), backgrounds (`background-color: #f8fafc`), borders, and padding.
- **Tables:** Full HTML `<table>` support with custom column widths (`<col width="...">` or `<th style="width: ...">`), header shading, cell alignments, borders, and multi-line content.
- **Layouts:** Use flexbox, CSS grids, and multi-column designs (`display: flex; justify-content: space-between`).
- **Page breaks:** Insert `<div style="page-break-after: always"></div>` to force a clean break before a new section.
- **Images & icons:** Inline `data:` URIs (`<img src="data:image/png;base64,...">`) work natively. Remote network URLs are blocked for privacy.
- **Headers & footers:** A page number (`X / Y`) is automatically typeset at the bottom center of each page.

## Writing with Markdown

Simple Markdown is also fully supported:
- Headings `#` to `######`, paragraphs, bold, italic, `inline code` and ~~strikethrough~~.
- Bulleted and numbered lists.
- Pipe tables (`| Col 1 | Col 2 |`).
- Fenced code blocks, block quotes, and horizontal rules.

## When to choose PDF

- The document will be read, printed or sent, not edited: reports, handouts, invoices, itineraries, reference sheets.
- If the user needs an editable file that can be opened and modified in Word, suggest .docx instead (which also supports tables, headings and styling via HTML).

## Writing it

1. One title heading at the top, followed by a subtitle or date.
2. Use clear section headings (`<h2>` or `##`) so the structure is clear when printed.
3. Use HTML when specific colors, side-by-side columns, invoices, or precise table widths are needed.
4. Choose a clear filename like trip-itinerary-june.pdf and call create_file with the HTML or Markdown content.

## After creating

Give the file name, what it contains in one line, and roughly how long it is. It is saved in Draggy's Created files.
