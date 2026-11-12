---
name: lookup-formulas
description: Chooses between XLOOKUP, INDEX with MATCH, VLOOKUP and related lookups, and writes one that handles misses, duplicates and mismatched types. Use when the user asks to pull values from another sheet, match two lists, or says a lookup returns N/A or the wrong row.
---

# Lookup formulas

## Goal

Return the right value for each key, say what happens when there is no match, and survive column inserts. A good result works on the user's actual application and version, and was tested on rows that match, rows that do not and rows with odd spacing.

## When to use

- Bringing a price, name or category from a reference table into another table.
- Comparing two lists to find what is in one and not the other.
- A lookup formula shows `#N/A` or returns a neighbour's value.
- For general formula help, use `use_skill` with `spreadsheet-formulas`.
- For cleaning the key columns first, use `use_skill` with `text-cleanup-formulas`.

## Steps

1. Identify the application and version with `ask_user` if unknown: modern Excel and Google Sheets have XLOOKUP, older Excel may not, and LibreOffice support depends on version. Check the live docs with `search_web` if the function's availability is in doubt.
2. Look at both tables with `read_file` or `run_command`. Name the key column on each side, the column to return, and the row counts. Check whether keys are unique in the lookup table.
3. Compare key types. Print the type and a sample of ten keys from both sides. Common mismatches are number against text, trailing spaces, non-breaking spaces and different case or leading zeros.
4. Pick the function. Use XLOOKUP when it exists, since it looks in any direction and has a not-found argument. Otherwise INDEX with MATCH, exact mode, which survives inserted columns. Use VLOOKUP only for quick work with the key in the first column, always with exact match.
5. Write the formula with absolute references for the table, such as `$A$2:$C$500`, and a defined name or table reference if the data grows. Show the formula for the first row only and say how to fill down.
6. Handle misses on purpose. Return an explicit marker like "not found" with the function's own argument or IFERROR scoped to the lookup, not around the entire formula, since that hides real errors.
7. Handle duplicates. A lookup returns the first match. If keys repeat, either say so and accept it, or use a multi-criteria approach, or a FILTER that returns all hits.
8. Test with `run_command` on a copy if the data is a file, or give the user five test keys: a normal one, a missing one, one with a trailing space, one at the end of the table, one duplicated.
9. Count the misses across the column and show the first few unmatched keys, since those are usually data problems and not formula problems.
10. Make the result easy to maintain.
   - Put the lookup table on its own sheet with a header and no blank rows.
   - Name the table or range so the formula reads like a sentence.
   - Add a short note beside the first formula saying what key it matches.
   - Keep a count of unmatched keys in a cell near the top, so a break is seen.

## Gotchas

- An approximate match is the default in VLOOKUP and MATCH when the last argument is omitted. On unsorted data it returns wrong rows without any error.
- A hardcoded column index in VLOOKUP breaks when someone inserts a column. INDEX with MATCH or XLOOKUP does not.
- Whole-column references in thousands of lookups slow a workbook badly. Use a bounded range or a table.
- Wildcards in keys, such as `*` or `?`, are treated as patterns in match modes that allow them.
- Pasting values over the formulas freezes results while the source changes. Keep the formula unless the user wants a snapshot.
- Looking up across workbooks creates a file link. If the source file moves or is renamed, every result turns into an error.

## Output

- The fallback for older versions, when the user needs one.
- The formula for the first row, with a one-line explanation of each argument.
- The handling of misses and duplicates as chosen.
- The test results, and the count and sample of unmatched keys.
