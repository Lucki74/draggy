---
name: docx
description: Creates Word documents (.docx) with create_file from structured HTML, for custom styling, tables, colors and fonts, or from Markdown for simple text. Use when the user asks for a Word document, a .docx, or an editable document to download.
---

# Word documents (.docx)

## Goal

Produce a clean, editable .docx file that matches the document type the user asked for. A good result has a clear structure, correct tables and styling, and a sensible file name.

## When to use

- The user asks for a Word document, a .docx, or an editable document to download.
- The document needs tables, colors, aligned headers or specific text sizes (use HTML), or is simple text (use Markdown).

## Steps

1. Decide the document type (letter, report, proposal, handout, policy) and its sections before writing.
2. Start with a title heading. For reports and proposals, add an executive summary near the top.
3. Pick the format. Draggy writes .docx files with `create_file` from either semantic HTML or Markdown. Use HTML when the document needs styling, tables, custom colors or specific text sizes. Use Markdown for simple plain-text documents.
4. Writing with HTML (recommended for styled documents and tables):
   - **Headings:** `<h1>` through `<h6>` become Word headings 1 to 6.
   - **Paragraphs:** `<p style="text-align: center; margin-bottom: 12pt">` with alignment (`left`, `center`, `right`, `justify`).
   - **Text styling:** `<span style="color: #0066cc; font-size: 14pt; font-weight: bold">`, `<em>`, `<u>`, `<s>`.
   - **Colors:** hex codes (`#2563eb`), rgb, or standard names.
   - **Lists:** `<ul><li>` for bullet points and `<ol><li>` for numbered items.
   - **Tables:** `<table>` elements with `<tr>`, `<th>`, `<td>`. Cell borders, widths (`<th style="width: 120px">` or `<col width="120">`) and cell background shading (`<th style="background-color: #f1f5f9">`) are supported.
   - **Page breaks:** `<hr>` or `<div style="page-break-after: always">`.
5. Writing with Markdown, which is converted line by line:
   - `#` to `######` headings become Word headings 1 to 6.
   - `- item` or `* item` becomes a bullet.
   - `1. item` becomes a numbered list item.
   - `**bold**`, `*italic*` and `***bold italic***` work inline.
   - `---` becomes a horizontal rule.
6. Choose a clear file name with no spaces or unusual characters, like quarterly-report-q3.docx. Call `create_file` with the file name and the full HTML or Markdown content.

## Gotchas

- Markdown pipe tables arrive as plain text. For tables, always use HTML `<table>`.
- HTML must be valid and semantic. Unclosed tags can break structure in the output.
- Spaces and unusual characters in the file name cause trouble when the file is shared or downloaded.
- Styling lives in inline `style` attributes, so set it on each element that needs it.

## Output

Tell the user the file name and that it is saved in Draggy's Created files (reachable from the sidebar). Summarise in one or two lines what the document contains.
