---
name: xlsx
description: "Creates Excel spreadsheets (.xlsx) with create_file from clean CSV: one header row, consistent columns, real numbers and dates that open ready to sort and filter. Use whenever the user asks for a spreadsheet, an Excel file, a table to download, or data in .xlsx."
---

# Excel spreadsheets (.xlsx)

Draggy writes .xlsx files with create_file. The content is CSV, which becomes a single worksheet named Sheet1.

## How the CSV is read

- Commas separate cells, new lines separate rows.
- Wrap any cell containing a comma, a quote or a line break in double quotes, and double any quote inside it: `"Smith, John"`, `"He said ""yes"""`.
- A cell that is a plain number becomes a real number: `1250`, `-3.5`, `0.75`. Anything else stays text.
- So write numbers with no thousands separators, no currency symbols, no percent signs and a dot as the decimal separator: `1250.50`, not `1,250.50 €`. Put the unit in the column header instead: `Price (EUR)`, `Growth (%)`.
- Formulas are not evaluated: `=SUM(B2:B9)` would appear as text. Calculate totals yourself and write the results, or tell the user which formula to add.
- Only one sheet per file. For several tables, create several files, or stack them in one sheet separated by an empty row and a title row.
- Empty rows are dropped.

## Designing the sheet

1. First row: short, unique headers. One kind of value per column.
2. One record per row. No merged cells, no blank columns inside the data.
3. Dates as ISO text `2025-03-14`, which sorts correctly and Excel recognises.
4. Put derived values (totals, averages) in a clearly labelled final row, and double-check the arithmetic before writing it. Show your working in the reply if the numbers matter.
5. Codes with leading zeros, such as 00123 or postal codes, stay text automatically, so their zeros survive.

## Example content

```
Item,Category,Quantity,Unit price (EUR),Total (EUR)
Desk chair,Furniture,4,149.00,596.00
"Monitor 27""",Electronics,4,229.00,916.00
"Cables, assorted",Electronics,10,6.50,65.00
Total,,,,1577.00
```

## After creating

Give the file name, the number of rows and columns, and the headers. Mention any calculations you made so the user can verify them.
