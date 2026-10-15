---
name: xlsx
description: "Creates Excel spreadsheets (.xlsx) with create_file from styled HTML tables (with custom column widths, colors, borders and numbers) or clean CSV. Use whenever the user asks for a spreadsheet, an Excel file, a table to download, or data in .xlsx."
---

# Excel spreadsheets (.xlsx)

Draggy writes .xlsx files with create_file. The content can be either an **HTML `<table>`** (recommended when you want custom column widths, colors, borders, or merged cells) or **CSV** (for plain tabular data).

## Styled HTML spreadsheets (Recommended)

Pass an HTML `<table>` string to create_file:

- **Column widths:** Set custom widths using `<col width="140">` or `<th style="width: 140px">`. Columns auto-size if omitted.
- **Headers:** Style header cells with `<th style="background-color: #2563eb; color: #ffffff; font-weight: bold; text-align: center">`.
- **Cell styling:** Supports `background-color`, font `color`, `font-weight`, `text-align` (align numbers `right`, text `left`), and borders.
- **Merged cells:** Supports `colspan` and `rowspan` (e.g. `<td colspan="4">Total</td>`).
- **Numbers:** Plain numeric strings (e.g. `1250.50`, `-3.5`) are automatically stored as native Excel numbers ready for formulas, sorting, and charting.
- **Multiple tables:** Place multiple `<table>` elements in the HTML to create stacked tables separated cleanly.

## Plain CSV spreadsheets

Pass standard CSV text:

- Commas separate cells, new lines separate rows.
- Wrap any cell containing a comma, a quote or a line break in double quotes: `"Smith, John"`, `"He said ""yes"""`.
- A cell that is a plain number becomes a real number: `1250`, `-3.5`, `0.75`. Write numbers with no thousands separators and a dot as the decimal separator (`1250.50`, not `1,250.50 €`). Put the unit in the column header instead: `Price (EUR)`, `Growth (%)`.
- Formulas are not evaluated: calculate totals yourself and write the results.
- Empty rows are dropped.

## Designing the sheet

1. First row: short, unique headers. One kind of value per column.
2. Align numbers to the right and text to the left.
3. Use background colors and bold text on header rows and summary/total rows for readability.
4. Dates as ISO text `2025-03-14`, which sorts correctly and Excel recognises.
5. Put derived values (totals, averages) in a clearly labelled final row, and double-check the arithmetic.

## Example content (HTML)

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

## After creating

Give the file name, the number of rows and columns, and the headers. Mention any calculations you made so the user can verify them.
