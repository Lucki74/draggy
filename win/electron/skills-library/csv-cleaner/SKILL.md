---
name: csv-cleaner
description: Cleans messy tabular data by fixing headers, trimming and normalising values, standardising dates and numbers, removing duplicates and flagging invalid rows, with a log of every change. Use when the user says "clean this CSV", "tidy this spreadsheet export", "fix my data file" or "remove duplicates from this list".
---

# CSV cleaner

## Goal

Turn a messy CSV, spreadsheet export or list into data that is ready to use, without losing or inventing anything. The user gets the cleaned data plus a log of what changed, and a short list of rows that need a human decision.

## When to use

- The user has a CSV, spreadsheet export or pasted list with inconsistent headers, dates, numbers or spellings.
- The user wants duplicates removed or invalid rows found.
- For questions about what the data shows (totals, trends), use `use_skill` with `data-analysis` after cleaning.

## Steps

1. Inspect before changing anything. Use `read_file` on the data and report: row and column counts, header problems, empty rows and columns, columns with mixed types, the date and number formats found, likely duplicates, and suspicious values (negative ages, future birth dates, emails without @).
2. Apply only the cleaning that is needed, in this order:
   1. **Headers:** unique, short, consistent (snake_case or Title Case), no line breaks.
   2. **Whitespace:** trim cells and collapse repeated inner spaces.
   3. **Empty rows and columns:** remove completely empty ones.
   4. **Types:** numbers without thousands separators or currency symbols, with a dot as decimal separator. Note the original locale first, because 1.234,56 and 1,234.56 differ. Make booleans consistent.
   5. **Dates:** convert to ISO YYYY-MM-DD. Detect day-first or month-first from values above 12. If every row is ambiguous, use `ask_user`.
   6. **Categories:** unify variants ("USA", "U.S.", "United States") with a mapping you show the user.
   7. **Duplicates:** remove exact duplicates. Flag near-duplicates, do not remove them.
   8. **Invalid values:** flag them in a separate `issue` column instead of deleting them.
3. Do the work in a script so it is repeatable and exact. Write a Python script (standard library `csv` module) and run it with `run_code`, or save it with `write_file` and run it with `run_command`. Write the cleaned result next to the original with `write_file` or from the script. For a small dataset you can clean it directly and show the result in the reply. For a large one, give the script and say how to run it.
4. Compare the result with the input: row counts add up against the change log, and no column lost data by accident.

## Gotchas

- Never invent missing values. Leave them empty and count them.
- Ambiguous dates such as 03/04/2021 cannot be resolved by guessing. Look for a value above 12 in the column, and ask when there is none.
- A decimal comma and a thousands comma look alike. Decide the locale per column from the data before stripping separators.
- Overwriting the original file removes the user's way back. Write to a new file.
- Near-duplicates ("Jon Smith" and "John Smith") may be two people. Flag them for the user.

## Output

A change log (what changed, how many cells or rows), the cleaned data or file (.csv, or .xlsx made with `create_file`), and a list of rows that need a human decision.
