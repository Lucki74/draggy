---
name: import-from-csv
description: Imports a CSV file into a workbook with the right encoding, delimiter and column types so dates, leading zeros and long numbers survive. Use when the user asks to open a CSV in Excel properly, says all columns landed in one cell, or says leading zeros or dates changed after import.
---

# Import from CSV

## Goal

Get CSV data into a sheet exactly as it exists in the file. A good import has the correct columns, accented characters intact, text columns kept as text, dates read in the right order, and a row count that matches the file.

## When to use

- A CSV opened by double-click shows everything in column A, or garbled characters.
- IDs, phone numbers or zip codes lost leading zeros, or long numbers turned into scientific notation.
- Dates were flipped between day-first and month-first, or turned into text.
- For cleaning the data inside the file by script, use `use_skill` with `csv-cleaner`.
- For building a workbook file from the data, use `use_skill` with `xlsx`.

## Steps

1. Inspect the raw file before opening it in a spreadsheet. Use `read_file` for the first 20 lines and `run_code` to count lines. Note the delimiter (comma, semicolon, tab, pipe), the quote character, whether there is a header, and any lines above the header.
2. Detect the encoding. A byte order mark points to UTF-8 with BOM. Accented letters turning into odd pairs of characters means UTF-8 read as a legacy encoding. Check with `run_code` by decoding as UTF-8 and counting replacement characters.
3. Count fields per line with `run_code`. If some lines have more fields than the header, a quote or delimiter inside a value is not escaped. Print three such lines and decide with the user how to handle them.
4. Decide each column's type before import: text for IDs, codes, phone numbers and anything with leading zeros; numbers for amounts; dates with a stated order, such as year-month-day. Mark the columns that must stay text.
5. Import through the data import feature (text import, or the data menu import in Sheets), not by double-clicking, so the delimiter, encoding and column types can be set. Give the user those exact settings.
6. If building a file instead, use `run_code` to read with all columns as strings, convert only the columns decided in step 4, and write the workbook with the types set. Keep the header row as the table header.
7. Reconcile after import: row count equals the line count minus the header, column count matches, and the first, middle and last rows are the same as in the file. Sum one numeric column in the sheet and in the code, and compare.
8. Check for the classic damage: leading zeros present, no scientific notation in long IDs, dates not swapped (look for a day over 12), and no cells ending up as hash signs from narrow columns.
9. Save the import settings or the script so the next file with the same layout takes a minute. Tell the user to keep the original CSV as the source of truth.
10. Plan for the next import.
   - If the file arrives regularly, set up a saved query or script that reads it, so settings are not re-entered.
   - Ask the sender to fix the export (quote text fields, use UTF-8) when the problem is at the source.
   - Add a row-count check cell that compares the sheet to the figure in the file name or the sender's note.
   - Keep each raw file with its date, and never overwrite an earlier one.

## Gotchas

- European locales use a semicolon as the delimiter and a comma for decimals. Opening such a file with comma settings splits the decimals into columns.
- Names that look like dates or numbers (some gene symbols, part numbers like `1E5`) get converted by auto-detection. Force text on those columns.
- A 16-digit or longer number is rounded to 15 significant digits by most spreadsheets. Card-like IDs and long account codes must be text.
- Re-saving the CSV from the spreadsheet bakes in the damage and may change quoting and encoding. Edit in the workbook and export a new file under a new name.
- Embedded line breaks in quoted cells make the line count differ from the row count. Count records with a parser, not with line counts.
- Files with a header split over two lines or a title block above the header need rows skipped on import. Count them before setting the first data row.

## Output

- The recommendation for the sender, if the export is the root of the problem.
- The detected settings: delimiter, encoding, header, and the types chosen per column.
- The reconciliation: rows, columns and one checked total.
- The saved import script or the click path, and any lines that were malformed.
