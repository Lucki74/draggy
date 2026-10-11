---
name: docx
description: "Creates Word documents (.docx) with create_file from structured HTML (for custom styling, tables, colors and fonts) or Markdown. Use whenever the user asks for a Word document, a .docx, or an editable document to download."
---

# Word documents (.docx)

Draggy writes .docx files with create_file from either semantic HTML or Markdown. Use HTML when the document needs styling, tables, custom colors, or specific text sizes; use Markdown for simple plain-text documents.

## Writing with HTML (Recommended for styled documents and tables)

Pass valid semantic HTML to create_file:

- **Headings:** `<h1>` through `<h6>` become Word headings 1 to 6.
- **Paragraphs:** `<p style="text-align: center; margin-bottom: 12pt">` with alignment (`left`, `center`, `right`, `justify`).
- **Text styling:** `<span style="color: #0066cc; font-size: 14pt; font-weight: bold">`, `<em>`, `<u>`, `<s>`.
- **Colors:** Hex codes (`#2563eb`), rgb, or standard names.
- **Lists:** `<ul><li>` for bullet points and `<ol><li>` for numbered items.
- **Tables:** `<table>` elements with `<tr>`, `<th>`, `<td>`. Supports cell borders, widths (`<th style="width: 120px">` or `<col width="120">`), and cell background shading (`<th style="background-color: #f1f5f9">`).
- **Page breaks:** `<hr>` or `<div style="page-break-after: always">`.

## Writing with Markdown

Simple Markdown is also converted line by line:
- `#` to `######` headings become Word headings 1 to 6.
- `- item` or `* item` becomes a bullet.
- `1. item` becomes a numbered list item.
- `**bold**`, `*italic*`, `***bold italic***` inline.
- `---` becomes a horizontal rule.
- *Note:* Markdown pipe tables arrive as plain text. For tables, always use HTML `<table>` instead.

## Designing the document

1. Decide the document type (letter, report, proposal, handout, policy) and its sections before writing.
2. Start with a title heading. For reports and proposals, add an executive summary near the top.
3. Use HTML when tables, colored callouts, or aligned headers are required.
4. Choose a clear file name with no spaces or unusual characters, like quarterly-report-q3.docx.
5. Call create_file with the filename and the full HTML or Markdown content.

## After creating

Tell the user the file name and that it is saved in Draggy's Created files (reachable from the sidebar). Summarise in one or two lines what the document contains.
