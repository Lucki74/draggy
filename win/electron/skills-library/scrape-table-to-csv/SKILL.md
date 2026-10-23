---
name: scrape-table-to-csv
description: Reads an HTML table from a web page, follows its pagination, and writes a clean CSV with typed numbers, a header check and row counts matched to what the page claims. Use when the user asks to turn a web table into a CSV, scrape a table, or export a table from a page.
---

# Scrape table to CSV

## Goal

Get tabular data off a page into a file that opens correctly in a spreadsheet. The row count matches the page, numbers are real numbers, and nothing is dropped silently.

## When to use

- The user points to a page with a table and wants a CSV.
- The table is split over several pages or loads as you scroll.
- For cleaning an existing CSV, use `use_skill` with `csv-cleaner`.
- For the same fields over many different pages, use `use_skill` with `multi-page-extract`.

## Steps

1. Confirm the address and which table with `ask_user` if the page has several. Check that the site's terms and robots rules allow automated reading when the data is not clearly public, and tell the user if they do not.
2. Try `read_url` first. If the table appears in the text, no browser is needed. If it is missing, the page builds it with scripts, so continue with `browser_navigate`.
3. Use `browser_snapshot` or `browser_get_elements` to locate the table and read its header cells. Use `browser_get_text` for the content. Note merged cells (colspan or rowspan), nested tables, and footers with totals.
4. Check for pagination or load-more buttons. Read the page's own count ("Showing 1 to 25 of 240") and record it. Click through pages with `browser_click`, waiting between them, and collect each page. Stop when the next control disappears or disables.
5. Parse in `run_code`: split rows, trim whitespace, remove footnote markers, expand merged cells by repeating the value, and give every column a unique, plain header. Keep the original text beside converted numbers if conversion could lose meaning.
6. Convert values deliberately: strip currency symbols and thousands separators into numbers, convert percentages to a stated form, parse dates to ISO form, and keep empty cells empty. State the locale you assumed for decimals.
7. Verify: the row count equals the page's count, no row has a different number of columns, totals add up if the page has a total row, and a sample of three rows matches the screenshot or text on the page.
8. Write the file with `create_file` using UTF-8, comma separators and quoted text fields. Add a small note file or a first-line comment only if the user wants one; otherwise keep the CSV pure.
9. Open the CSV back with `read_file` and read the first and last rows to confirm quoting and encoding came out right, including any accented characters.

## Gotchas

- Numbers formatted as "1.234,56" in many locales parse wrongly as 1.234. Identify the locale before converting.
- Rows hidden by filters or sorting still show on other pages. Make sure the page filters are the ones the user wants.
- Some tables are made of div elements and look like tables. The snapshot shows the real structure.
- Footers, ads and "sponsored" rows can sit inside the table. Exclude them and say so.
- Fast clicking through pages can trigger rate limits. Wait between requests, and stop if the site asks you to slow down.
- Data on the page may have its own licence. Remind the user to check before republishing.
- Leading zeros in codes and ZIP-like fields vanish when a spreadsheet reads them as numbers. Tell the user, or quote those columns.
- Links inside cells carry data too. Add a column for the address if the user needs it.

## Output

- A note on columns that a spreadsheet may misread.
- The CSV path, column list and row count against the page count.
- The assumptions: locale, date format, rows excluded.
- Any mismatch that remains.
