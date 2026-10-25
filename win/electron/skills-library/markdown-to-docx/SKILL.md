---
name: markdown-to-docx
description: Converts a Markdown file into a styled Word document, mapping headings, lists, tables, code and images, then checks the rendered result. Use when the user asks to turn markdown into a Word doc, export notes as docx, or convert a README or report to Word.
---

# Markdown to Word

## Goal

Produce a .docx that looks like a document a person made, with real heading styles, working lists and tables, and no leftover Markdown syntax. A good result also keeps the source file untouched and says what could not be converted.

## When to use

- The user has a .md file or pasted Markdown and wants a Word file.
- The user wants a company template or a reference style applied to converted text.
- For creating a Word document from scratch with no Markdown source, use `use_skill` with `docx`.
- For filling a template from data, use `use_skill` with `docx-template-fill`.

## Steps

1. Read the source with `read_file`. Note headings, tables, code blocks, footnotes, images, front matter and any raw HTML. Check heading levels for skips such as `#` followed by `###`.
2. Check the tools. Run `run_command` with `pandoc --version`. If pandoc is missing, use a docx library through `run_code` and tell the user the mapping will be simpler.
3. Ask with `ask_user` whether there is a reference .docx for styles, the page size (A4 or Letter), and whether to include a table of contents. Without a reference, use the default styles and say so.
4. Resolve images. List every image path in the source. Relative paths resolve from the Markdown file's folder, so run the conversion from there or pass a resource path. Web images need a download, so ask first.
5. Convert. With pandoc, pass the reference doc if there is one, and write to a new file next to the source. Convert front matter to title and author fields, not body text.
6. Fix known weak spots: wide tables (set column widths or landscape), code blocks (monospace style, no smart quotes), and task list checkboxes (convert to symbols).
7. Verify structure with `run_code`: unzip the docx, count heading paragraphs, tables and images, and compare with the source. Search the text for leftover `**`, `##`, backticks and `](`.
8. If a renderer is available, convert to PDF with `run_command` and look at page one and a table page for overflow.
9. Polish the document properties.
   - Set title, author and language so spell check and accessibility tools work.
   - Add page numbers in the footer if the document is longer than a few pages.
   - Set alt text for images from the Markdown alt text, and warn about images that have none.
   - Check that the table of contents, if present, lists the headings and refreshes on open.
10. Save the exact conversion command in the reply so the user can rerun it after editing the source.

## Gotchas

- Smart punctuation conversion turns straight quotes in code into curly ones. Keep code blocks verbatim.
- Nested lists lose indentation when the source mixes tabs and spaces. Normalise the indentation first.
- Tables with long cell text run off the page. Use a fixed layout or landscape for those sections.
- Footnotes become real Word footnotes in pandoc, but not in simple converters. Check that they landed at the page bottom or the end.
- Heading numbering is not automatic. If the user wants numbered headings, set it in the reference style, do not type numbers into the text.
- Math written in LaTeX only converts to Word equations in some tools. Check one equation, and if it came out as raw text, say so.

## Output

- Which style mapping was used: the default or the user's reference file.
- The path of the new .docx, with the source file named as untouched.
- A list of things converted by approximation, such as task lists or raw HTML blocks.
- The checks run and their results, in two or three lines.
