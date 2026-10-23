---
name: text-cleanup-formulas
description: Cleans, splits, joins and extracts text in spreadsheet cells with formulas, keeping the raw column untouched. Use when the user asks to split full names into first and last, remove extra spaces from a column, or extract a number or code from a text string.
---

# Text cleanup formulas

## Goal

Turn messy text columns into clean, consistent ones using formulas that stay linked to the raw data. A good result leaves the original column alone, handles the odd rows, and has been checked by counting how many rows changed and spot-reading a sample.

## When to use

- Names, addresses, product codes or free text with stray spaces, odd case or mixed formats.
- One cell holds several facts to separate, or several cells must be combined.
- Pulling a number, an email domain or an ID out of a longer string.
- For cleaning a whole CSV file by script, use `use_skill` with `csv-cleaner`.
- For fixing date text, use `use_skill` with `dates-and-time-formulas`.

## Steps

1. Look at the column with `read_file` or `run_code`. Print 30 sample values chosen from the top, middle and end, plus the shortest and longest. Note the patterns: separators used, case, prefixes, and values that do not follow the pattern.
2. Write the target form for three real examples: input, wanted output. Ask with `ask_user` about edge cases that matter, such as names with three parts, titles, or missing values.
3. Keep the raw column. Put the cleaned result in a new column beside it, and leave the originals until the user has checked the output.
4. Strip first. TRIM removes extra spaces but not the non-breaking space (character 160), so replace that with a normal space before trimming. CLEAN removes non-printing characters. Apply these two before any splitting.
5. Normalise case with UPPER, LOWER or PROPER, knowing that PROPER mishandles names like `McDonald`, `van der Berg` and acronyms. Offer a rule for exceptions or a short fix list.
6. Split or extract. If the app has TEXTSPLIT or TEXTBEFORE and TEXTAFTER, use them. Otherwise combine FIND or SEARCH with LEFT, MID and RIGHT, with a fallback for rows missing the separator. Show the formula for the first row and explain each part.
7. Join with TEXTJOIN to skip blanks, or with `&` plus a separator. Use TEXT to format numbers and dates inside the joined string.
8. Convert type when needed. Text that looks like a number can be turned with VALUE after removing symbols. Keep leading zeros by leaving the field as text, and format the result column as text before pasting values.
9. Check with `run_code`: count rows that came out empty, errored or unchanged, list ten that changed, and list every row that did not match the expected pattern. Fix patterns rather than patching single cells.
10. When the user is satisfied, copy and paste as values into the final column if the sheet will be shared, and keep the formulas on a work sheet.
11. Keep the cleanup repeatable.
   - Leave the formulas in a `Clean` sheet that reads from the raw sheet, so a new load refreshes it.
   - Write the rules as one line each beside the columns, such as "trim, then proper case".
   - Keep the exception list as a small lookup table instead of hand-edited cells.
   - Note which columns still need a human check, and why.

## Gotchas

- A non-breaking space from a web copy looks identical to a space, survives TRIM and breaks matching. Search for character 160 whenever lookups fail on text that looks equal.
- Splitting on a space breaks names and addresses with more than two parts. Decide the rule for the last word, and test with a three-part name.
- Spreadsheet imports silently drop leading zeros from codes and zip codes. Once lost in a number cell, they cannot be recovered from the cell.
- Formulas that depend on the character position fail when one row has a different prefix length. Use a delimiter search where possible.
- Replacing formulas by pasted values too early loses the link to the source, and the next data load must be cleaned by hand.
- Case rules differ by language. Upper-casing some letters changes their form, so test with the real names in the data, not English samples.

## Output

- The exception table and the rules in one line each.
- The formula for the first row for each new column, with a short explanation.
- The counts: rows changed, empty, errored, and the list of exceptions.
- The recommended final step, formulas kept or values pasted.
