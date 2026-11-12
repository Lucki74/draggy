---
name: table-extraction
description: Extracts tables from PDFs, Word files and web pages into clean CSV, then checks row counts and totals against the source. Use when the user asks to pull a table out of a document, get table data into Excel, or extract the data tables from a report.
---

# Table extraction

## Goal

Move a table from a document into a tidy CSV or sheet with the right cells in the right columns and numbers stored as numbers. A good result has been compared with the source for row count and at least one total, with problems listed.

## When to use

- A report, statement or web page holds data in a table that must be reused.
- The copy and paste into a sheet shifted columns or merged cells.
- For plain text cleanup of PDF prose, use `use_skill` with `pdf-to-text-cleanup`.
- For putting a clean CSV into a workbook, use `use_skill` with `xlsx`.

## Steps

1. Locate the tables. For a PDF, run `run_command` to count pages and find the pages with table-like text. For a web page, use `read_url` or `browser_get_text`. For a docx, read the table elements from the XML with `run_command`.
2. Decide the method by file type. Born-digital PDF tables work with a table-aware library or a layout text mode. Scanned PDFs need OCR first, so say so and ask before continuing. HTML and docx tables can be read directly from the structure.
3. Extract one table first. Print it as rows and look at the header, the first three rows and the last three. Check the column count of every row, since a ragged width means a merge or wrapped cell.
4. Rebuild the header. Multi-line headers become one name per column joined with a space. Repeated header rows on every page are removed. Subtotal and total rows are tagged, not deleted.
5. Handle tables that split across pages by appending rows, then check that the join did not duplicate a row at the page break.
6. Clean values with `run_command`: strip currency symbols and thousands separators into plain numbers, turn `(1,200)` into `-1200` only if the source uses brackets for negatives, and keep leading zeros in codes as text. Record the unit shown in the header.
7. Check against the source: row count equals the printed rows, the column sums match any total row, and five random cells equal the original. Fix, then rerun.
8. Save each table as its own CSV with `create_file`, named by its caption or page, and list them.
9. Prepare the data for its next use.
   - Add a column for the source page or table number if several tables were merged into one file.
   - Write a short data note: units, date format, what the blank cells mean.
   - Check encoding by saving as UTF-8 so accented names survive a spreadsheet import.
   - Do not merge tables of different layouts into one file just to reduce the file count.
10. If the user wants the data in a workbook, hand over to the `xlsx` skill with the CSV paths.

## Gotchas

- European number formats use a comma for decimals. Reading `1.234,50` with a US parser gives nonsense. Detect the format from the whole column.
- A cell that wraps over two lines may come out as two rows. A row with only one filled cell next to a row with the rest is the sign.
- Merged header cells span several columns. Fill the label across the columns instead of leaving blanks.
- Footnote markers glued to numbers (`1,250*`, `37 (a)`) turn a numeric column into text. Strip and keep the marker in its own column.
- Never round or recalculate values to make totals match. Report the difference.
- Tables drawn as images (screenshots in a report) have no data to extract. Tell the user, and offer OCR as a lossy route that needs checking.

## Output

- The method used for each table: layout text, structure or OCR.
- The CSV paths with row and column counts for each table.
- The reconciliation: which totals were checked and whether they matched.
- A list of known issues, such as cells that were unreadable.
