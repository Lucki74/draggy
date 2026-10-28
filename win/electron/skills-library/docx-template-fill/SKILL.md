---
name: docx-template-fill
description: Fills placeholders in a Word template from a data row or table, one output file per record, and checks that no placeholder is left behind or layout broken. Use when the user asks to fill a letter template for each client, do a mail merge into Word, or replace placeholders in a template.
---

# Word template fill

## Goal

Generate finished documents from a template and a data source without touching the template's design. A good result has one file per record, every placeholder replaced, no layout damage, and a log tying each output to its data row.

## When to use

- A template contains markers such as `{{name}}`, `[Client]` or `<<Date>>` and a spreadsheet holds the values.
- The user needs the same letter, certificate or quote for many people.
- For converting Markdown to Word, use `use_skill` with `markdown-to-docx`.
- For forms with fields rather than text markers, use `use_skill` with `form-filler`.

## Steps

1. Read the data with `read_file` or `run_command` (CSV or XLSX). Print the header row and three records. Ask with `ask_user` which column is the filename key if it is not obvious.
2. Find the placeholders in the template. Unzip the docx with `run_command` and scan `document.xml`, headers, footers and footnotes for the marker pattern. List each unique marker and match it to a column. Report markers with no column and columns with no marker.
3. Check split markers. Word often splits `{{name}}` across several runs because of spell check or formatting. Search the paragraph text, not the raw XML, and replace at paragraph level, keeping the formatting of the first run.
4. Define the formatting rules for values: dates in one format, money with the right decimals and currency, uppercase names if the template expects them. Show two example conversions.
5. Run a trial with the first record only. Save it, then check the text for remaining markers, and render to PDF if a converter exists, to look at the layout.
6. Generate all records to an output folder, naming files from the key column with unsafe characters removed. Add a counter if keys repeat.
7. Verify with `run_command`: the count of outputs equals the count of rows, no marker pattern remains in any file, and a sample of three files contains the right values.
8. Write a log with `create_file`: row number, key, output file, warnings.
9. Hand back something the user can rerun.
   - Save the replacement script or the marker-to-column map next to the output folder.
   - Note the template file name and its modified date in the log.
   - Mention that a changed template needs a new trial run before a full batch.
   - Offer to also produce a combined PDF for printing if a converter exists.
10. Do not email or upload the outputs. Sending is the user's step.

## Gotchas

- Empty cells produce blank gaps such as `Dear ,`. Decide per field whether blank means skip, default text or stop, and flag the rows.
- Long values (company names, addresses) wrap and push a signature block onto a second page. Check the page count across all outputs, since the first record is rarely the longest.
- Markers in headers, footers and text boxes are in other XML parts, and a body-only replace misses them.
- Values containing `&`, `<` or quotes break the XML if inserted as raw text. Escape them or use a library that does.
- Never overwrite the template. Work on copies.
- Repeating blocks (a list of line items per client) need a loop or a table row copy. A single-value replace cannot do that, so say when the template needs it.

## Output

- The marker-to-column map, so a reviewer can see what was bound to what.
- The output folder path, the file count and the log file path.
- Warnings: rows with empty fields, overlong values, duplicate keys.
- Template left unchanged, and a sample file named for the user to open first.
