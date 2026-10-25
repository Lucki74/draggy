---
name: spreadsheet-formulas
description: Writes and explains Excel, Google Sheets and LibreOffice formulas (lookups, conditional sums, dates, text, array formulas and pivot-style summaries) and fixes formula errors. Use when the user asks how to calculate something in a spreadsheet, says a formula returns #N/A or #VALUE!, or wants a formula explained.
---

# Spreadsheet formulas

## Goal

Give a formula that works in the user's application and layout, explain each part, and show the result on sample values. When a formula is broken, name the cause of the error and give the corrected version.

## When to use

- The user asks how to calculate, look up, count, sum, filter or summarise something in a spreadsheet.
- The user has a formula that returns an error or the wrong value.
- To create a new .xlsx file, use `use_skill` with `xlsx`.

## Steps

1. Clarify the application: Excel (which version, since 365 has dynamic arrays and XLOOKUP and older versions do not), Google Sheets, LibreOffice Calc or Numbers.
2. Clarify the layout: which columns hold what, where the header row is, and where the result should go. Ask for a small sample or the column letters if needed.
3. Check the locale. Some locales use `;` instead of `,` between arguments. If the user writes formulas with `;`, answer with `;`.
4. Write the formula. Prefer modern, robust functions where available: XLOOKUP or INDEX/MATCH over VLOOKUP, SUMIFS/COUNTIFS over SUMPRODUCT tricks, and FILTER, UNIQUE and SORT in Excel 365 and Google Sheets.
5. Use absolute references ($A$2) where the formula will be copied, and explain which parts are locked.
6. Handle errors deliberately with IFERROR or IFNA, in a way that does not hide real problems.
7. For dates, use DATE, EDATE, EOMONTH and NETWORKDAYS rather than text manipulation.
8. In larger sheets, suggest named ranges or tables (structured references) for readability. Offer a pivot table instead when the user is building a summary by category.
9. When fixing an error, explain what it means, then give the corrected formula:
   - #N/A: no match. Check spaces and types.
   - #VALUE!: wrong type, often numbers stored as text.
   - #REF!: deleted cells.
   - #DIV/0!: division by zero or an empty cell.
   - #NAME?: misspelt function, or function names that differ by locale.
   - #SPILL!: a dynamic array is blocked by cells in its way.

## Gotchas

- XLOOKUP, FILTER, UNIQUE and SORT do not exist in older Excel. Without a fallback the user gets #NAME?.
- A formula copied without absolute references drifts and quietly returns wrong values.
- Wrapping everything in IFERROR hides real problems such as a mistyped range.
- Numbers stored as text break lookups and sums while looking fine on screen.
- Argument separators and function names depend on locale. A comma-separated formula fails in a semicolon locale.

## Output

The formula in a code block, where to put it, a short explanation of each part, and an example of the result on sample values. Give an alternative for older Excel versions when using 365-only functions.
