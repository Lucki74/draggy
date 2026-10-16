---
name: spreadsheet-formulas
description: Writes and explains Excel, Google Sheets and LibreOffice formulas (lookups, conditional sums, dates, text, array formulas and pivot-style summaries) and fixes formula errors. Use when the user asks how to calculate something in a spreadsheet or has a formula that returns an error.
---

# Spreadsheet formulas

## Clarify

- The application: Excel (which version: 365 has dynamic arrays and XLOOKUP, older versions do not), Google Sheets, LibreOffice Calc, Numbers.
- The layout: which columns hold what, where the header row is, and where the result should go. Ask for a small sample or column letters if needed.
- The locale: some locales use `;` instead of `,` between arguments. If the user writes formulas with `;`, answer with `;`.

## Writing formulas

- Prefer modern, robust functions where available: XLOOKUP or INDEX/MATCH over VLOOKUP, SUMIFS/COUNTIFS over SUMPRODUCT tricks, FILTER, UNIQUE, SORT in Excel 365 and Google Sheets.
- Use absolute references ($A$2) where a formula will be copied, and explain which parts are locked.
- Handle errors deliberately with IFERROR or IFNA, but not in a way that hides real problems.
- For dates, use DATE, EDATE, EOMONTH, NETWORKDAYS rather than text manipulation.
- Suggest named ranges or tables (structured references) for readability in larger sheets.
- Offer a pivot table instead when the user is building a summary by category.

## Fixing errors

Explain what the error means: #N/A (no match: check spaces and types), #VALUE! (wrong type, often numbers stored as text), #REF! (deleted cells), #DIV/0!, #NAME? (misspelt function or locale function names), #SPILL! (blocked dynamic array). Then give the corrected formula.

## Output

The formula in a code block, where to put it, a short explanation of each part, and an example of the result on sample values. Give an alternative for older Excel versions when using 365-only functions.
