---
name: docx
description: "Creates Word documents (.docx) with create_file from well-structured Markdown: headings, lists, emphasis and page breaks that Draggy converts faithfully. Use whenever the user asks for a Word document, a .docx, or an editable document to download."
---

# Word documents (.docx)

Draggy writes .docx files with create_file. The content you pass is Markdown, converted line by line, so the Markdown must use only what the converter understands.

## What converts

- `#` to `######` headings become Word headings 1 to 6. Use one `#` title, then `##` sections, `###` subsections.
- `- item` or `* item` becomes a bullet. Only one level: nested indentation is flattened.
- `1. item` becomes a numbered list item.
- `**bold**`, `*italic*` and `***bold italic***` inside a line.
- A line with only `---` becomes a horizontal rule.
- An empty line becomes an empty paragraph, so use exactly one blank line between blocks.
- Every other line becomes a normal paragraph. Write each paragraph on a single line.

## What does not convert

- **Tables:** Markdown tables arrive as plain text rows. For tabular content, use a short list per row ("**Q1:** revenue 4.2 M, costs 3.1 M"), or create a .pdf (tables work there) or an .xlsx for the data.
- Links become plain text: write the URL out in full if it matters.
- Images, footnotes, code blocks with syntax colours, and nested lists.

## Writing the document

1. Decide the document type (letter, report, proposal, handout, policy) and its sections before writing.
2. Start with a `#` title. For reports and proposals, add a short summary paragraph near the top.
3. Keep paragraphs short and headings descriptive, since readers navigate by them.
4. Choose a clear file name with no spaces or unusual characters, like quarterly-report-q3.docx.
5. Call create_file with the filename and the full Markdown as content.

## After creating

Tell the user the file name and that it is saved in Draggy's Created files (reachable from the sidebar). Summarise in one or two lines what the document contains. If content was simplified because of the limits above (a table turned into a list), say so.
