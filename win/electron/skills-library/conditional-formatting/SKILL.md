---
name: conditional-formatting
description: Writes conditional formatting rules that highlight overdue items, values above target, duplicates or outliers, with correct references, rule order and a legend. Use when the user asks to highlight cells or rows by a condition, colour values against a target, or make duplicates stand out.
---

# Conditional formatting

## Goal

Make the rows that need attention visible at a glance, with rules that stay right as the sheet grows. A good set has few rules, each tied to a stated meaning, built on formulas that reference the right cell, and a legend that tells readers what the colours mean.

## When to use

- Highlighting overdue tasks, low stock, values over or under a target.
- Colouring a whole row based on one cell, such as status.
- Marking duplicates, blanks, errors or the top and bottom values.
- For stopping the bad entries in the first place, use `use_skill` with `data-validation-rules`.
- For a full tracker layout, use `use_skill` with `tracker-sheet`.

## Steps

1. Write each rule as a sentence with the user: "Red fill when the due date is before today and status is not Done." If two rules would give the same colour for different reasons, split or merge them on purpose.
2. Look at the data with `read_file` or `run_code`: which columns hold the dates, numbers or status, whether they are true dates or text, and the range of rows. A rule on text dates will not fire.
3. Choose the rule kind. Built-in kinds (greater than, top 10, duplicates, colour scales, data bars, icon sets) fit simple cases. A formula rule fits row highlighting and multi-column logic.
4. For a formula rule, write the formula as if for the top-left cell of the applied range. Lock the column and free the row for row highlighting, for example `=$E2="Overdue"`. Lock both parts only when every cell should compare against one fixed cell.
5. Set the applied range to the data body, not whole columns, and to the whole row width for row highlighting. Use a table so new rows inherit the rule.
6. Order the rules. Put the most important first, set stop-if-true where later rules should not also colour the cell, and test the case where two rules both match.
7. Choose colours with meaning and contrast. Use at most three fills, keep text readable on them, and pair colour with a second cue such as bold text, a symbol or a status word in the cell. Test in grayscale.
8. Test with `run_code` against a copy of the data, or by listing five sample rows and what each should look like: a matching row, a non-matching one, a blank, an edge value equal to the target.
9. Add a legend near the top or on a notes area: colour swatch and one-line meaning. List the rules with their ranges in the reply so the next editor can find them.
10. Clean up and keep the rule set small.
   - Remove rules that no longer apply and merge ones with the same formula and colour.
   - Keep the total under about six rules per sheet, since every rule adds recalculation.
   - Check that the rules still apply after the last row is added or a column is inserted.
   - Name the rules in the reply so the user can find them in the rule manager.

## Gotchas

- Copying and pasting cells duplicates rules and splits ranges, leaving dozens of overlapping rules. Check the rule manager after heavy editing.
- A relative reference that looks right in the first row can point one row off in the rest if the formula was written for the wrong top-left cell.
- Today-based rules change daily. A printed or screenshot copy shows the date it was made, so label it.
- Colour scales on a column with an extreme outlier turn everything else the same shade. Set fixed minimum and maximum points.
- Blank cells count as zero in some comparisons and turn red under a "less than" rule. Add a not-blank test.
- Formatting is not data. Filtering or counting by colour does not work in every app, so keep a real status column behind the colour.

## Output

- The recommendation for a real column to hold the status the colour shows.
- A table of rule, applies to, formula or kind, colour, meaning.
- The legend text and the test cases with expected look.
- Any rule that the application cannot do, and the closest alternative.
