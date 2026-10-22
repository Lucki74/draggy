---
name: xlsx
description: "Creates Excel spreadsheets (.xlsx) with create_file from styled HTML tables (with custom column widths, colors, borders and numbers) or clean CSV. Use when the user asks for a spreadsheet, an Excel file, a table to download, or data in .xlsx."
---

# Excel spreadsheets (.xlsx)

## Goal

Produce a downloadable .xlsx with clean headers, real numeric cells and readable styling. Draggy writes .xlsx files with `create_file`, and the content is either an HTML `<table>` (recommended for custom column widths, colors, borders or merged cells) or CSV (for plain tabular data).

## When to use

- The user asks for a spreadsheet, an Excel file, a table to download, or data in .xlsx.
- The user wants a plan, budget or tracker as a sheet.
- For writing or fixing formulas, use `use_skill` with `spreadsheet-formulas`.
- For cleaning an existing CSV, use `use_skill` with `csv-cleaner`.

## Steps

1. Design the sheet first:
   - First row: short, unique headers. One kind of value per column.
   - Align numbers to the right and text to the left.
   - Use background colors and bold text on header rows and on summary or total rows.
   - Write dates as ISO text `2025-03-14`, which sorts correctly and Excel recognises.
   - Put derived values (totals, averages) in a clearly labelled final row and double-check the arithmetic.
2. Choose the format. Use styled HTML for anything with widths, colors or merged cells. Use CSV for plain data.
3. For styled HTML, pass an HTML `<table>` string to `create_file`:
   - **Column widths:** set them with `<col width="140">` or `<th style="width: 140px">`. Columns auto-size if omitted.
   - **Headers:** style header cells with `<th style="background-color: #2563eb; color: #ffffff; font-weight: bold; text-align: center">`.
   - **Cell styling:** `background-color`, font `color`, `font-weight`, `text-align` (numbers `right`, text `left`) and borders are supported.
   - **Merged cells:** `colspan` and `rowspan` work, for example `<td colspan="4">Total</td>`.
   - **Numbers:** plain numeric strings (`1250.50`, `-3.5`) are stored as native Excel numbers, ready for formulas, sorting and charting.
   - **Multiple tables:** several `<table>` elements in the HTML become stacked tables.
4. For CSV, pass standard CSV text:
   - Commas separate cells and new lines separate rows.
   - Wrap any cell containing a comma, a quote or a line break in double quotes: `"Smith, John"`, `"He said ""yes"""`.
   - A cell that is a plain number becomes a real number: `1250`, `-3.5`, `0.75`. Write numbers with no thousands separators and a dot as the decimal separator (`1250.50`, not `1,250.50 €`). Put the unit in the column header instead: `Price (EUR)`, `Growth (%)`.
   - Formulas are not evaluated, so calculate totals yourself and write the results.
   - Empty rows are dropped.

Example content (HTML):

```html
<table>
  <col width="180">
  <col width="120">
  <col width="80">
  <col width="120">
  <col width="120">
  <thead>
    <tr style="background-color: #1e293b; color: #ffffff;">
      <th style="text-align: left;">Item</th>
      <th style="text-align: left;">Category</th>
      <th style="text-align: right;">Quantity</th>
      <th style="text-align: right;">Unit price (EUR)</th>
      <th style="text-align: right;">Total (EUR)</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Desk chair</td>
      <td>Furniture</td>
      <td style="text-align: right;">4</td>
      <td style="text-align: right;">149.00</td>
      <td style="text-align: right;">596.00</td>
    </tr>
    <tr style="background-color: #f8fafc; font-weight: bold;">
      <td colspan="4">Total</td>
      <td style="text-align: right;">596.00</td>
    </tr>
  </tbody>
</table>
```

## Gotchas

- A number written as `1,250.50 €` becomes text. Use `1250.50` and put the unit in the header.
- Formulas are not evaluated, so write computed totals as values and check the arithmetic yourself.
- A cell with a comma, quote or line break in CSV must be wrapped in double quotes, or the columns shift.
- Empty rows are dropped, so do not use blank rows as spacers in CSV.
- Mixed value types in one column break sorting and charting.

## Output

Give the file name, the number of rows and columns, and the headers. Mention any calculations you made so the user can verify them.
