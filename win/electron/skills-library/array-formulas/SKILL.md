---
name: array-formulas
description: Writes array and dynamic array formulas (FILTER, SORT, UNIQUE, SUMPRODUCT, MAP style) that replace helper columns, with fallbacks for apps without them. Use when the user asks to list unique values, filter rows with a formula, or sum on several conditions without helper columns.
---

# Array formulas

## Goal

Replace a block of copied-down helper formulas with one formula that returns the whole result, and make sure it works in the user's application. A good answer names the version requirement, shows the output shape, and has a fallback when the feature is missing.

## When to use

- Extracting unique values, a filtered list or a sorted list from a table.
- Multi-condition sums, counts or averages that need a product of conditions.
- Replacing a column of near-identical formulas with a single spilling one.
- For simple lookups, use `use_skill` with `lookup-formulas`.
- For general formula questions, use `use_skill` with `spreadsheet-formulas`.

## Steps

1. Confirm the application and version with `ask_user`. Dynamic arrays (spilling results) exist in current Excel for Microsoft 365 and in Google Sheets, with different function sets. Older Excel needs control-shift-enter array formulas, and LibreOffice has its own support. Check the live documentation with `search_web` or `read_url` when the version matters.
2. Look at the data with `read_file` or `run_code`: the ranges, header row, types and size. State the result the user wants: a list, a single number or a matrix, and which order.
3. Write the target in words. For example "all rows where region is West and amount is over 1000, sorted by date, newest first".
4. Build from the inside out and show each layer. First the condition: `(Region="West")*(Amount>1000)`. Then FILTER over it with a not-found argument, then SORT around that. Name ranges or use table columns to keep formulas readable.
5. For counting and summing with multiple conditions, compare SUMPRODUCT with SUMIFS/COUNTIFS. Use the IFS family when conditions are plain equalities, and SUMPRODUCT when conditions need arithmetic or OR logic.
6. For unique values use UNIQUE, and for counts per unique value pair it with COUNTIFS against the spill using the spill reference operator. Sort the result if the user wants a ranking.
7. Check the spill area. The cells below and to the right must be empty. State where the result lands and what sits next to it, and warn that other formulas should refer to the spill with the spill operator, not a fixed range.
8. Test with `run_code` on the user's data or on a small table with known answers. Report the row count the formula returns against the count expected, including a case with zero matches.
9. Give the fallback for older versions: a helper column with a flag and a running number, plus INDEX/SMALL or a pivot. Offer it only if the user needs the sheet to open elsewhere.
10. Keep the result usable downstream.
   - Name the spill range or reference its top cell with the spill operator in other formulas.
   - Put a count of returned rows in a cell next to it, so a silent zero-row result is noticed.
   - Add a header row above the result as plain text, since spills do not carry headers by themselves.
   - Tell the user how to convert the spill to static values if they must send it on.

## Gotchas

- A spill blocked by any content in its path returns a spill error. Clear the area or move the formula.
- Whole-column references inside array formulas make the sheet slow, since each cell evaluates a million rows. Use bounded ranges or table columns.
- Blank cells in a FILTER result come back as zero. Wrap with a text join or a check if blanks matter.
- Multiplying conditions with `*` means AND, adding with `+` means OR. Mixing them without brackets gives wrong rows.
- A file saved in the newer format opens with broken formulas in an old viewer, and nothing warns the sender.
- Charts and pivots built on a spill need the spill reference, not a typed range, or they miss rows when the result grows.

## Output

- The header and row-count cells added next to the result.
- The formula, built up in layers, with a one-line explanation each.
- Where it spills and what that range must keep free.
- Test result with expected and actual counts, and the fallback if one was needed.
