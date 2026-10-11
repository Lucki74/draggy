---
name: csv-cleaner
description: "Cleans messy tabular data: fixes headers, trims and normalises values, standardises dates and numbers, removes duplicates and flags invalid rows, reporting every change. Use when the user has a messy CSV, spreadsheet export or list that needs tidying before use."
---

# CSV cleaner

## Inspect first

Report before changing anything: number of rows and columns, header problems, empty rows and columns, columns with mixed types, date and number formats found, likely duplicates, and suspicious values (negative ages, future birth dates, emails without @).

## Cleaning steps (apply only what is needed, and in this order)

1. **Headers:** unique, short, consistent (for example snake_case or Title Case), no line breaks.
2. **Whitespace:** trim cells; collapse repeated inner spaces.
3. **Empty rows and columns:** remove completely empty ones.
4. **Types:** numbers without thousands separators or currency symbols, with a dot decimal separator (note the original locale, since 1.234,56 and 1,234.56 differ); booleans consistent.
5. **Dates:** convert to ISO YYYY-MM-DD. Detect day-first vs month-first from values above 12; if ambiguous for all rows, ask.
6. **Categories:** unify variants ("USA", "U.S.", "United States") with a mapping shown to the user.
7. **Duplicates:** exact duplicates removed; near-duplicates flagged, not removed.
8. **Invalid values:** flagged in a separate column `issue` rather than silently deleted.

Never invent missing values. Leave them empty and count them.

## Doing it

- **In Code**, write a script with run_code (python, standard library csv module) or as a file run with run_command, so the cleaning is repeatable and exact. Write the result with write_file or from the script into the project.
- **In Chat**, clean small data directly and show the result; for large data, provide the script and explain how to run it.

## Output

A change log (what changed, how many cells or rows), the cleaned data or file (.csv or .xlsx with create_file in Chat), and a list of rows that need a human decision.
