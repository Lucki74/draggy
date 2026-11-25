---
name: data-validation-rules
description: Adds data validation to spreadsheet cells, including dropdown lists, number and date limits, custom formula rules and clear error messages. Use when the user asks to add a dropdown to a column, stop bad entries, or restrict input to a list or range.
---

# Data validation rules

## Goal

Make bad entries hard to type and good entries quick, in a way that keeps working as the sheet grows. A good rule set has a list source that lives in one place, messages that say what is allowed, and a known answer to what happens when someone pastes.

## When to use

- A column needs a fixed set of choices such as status, region or owner.
- Dates, quantities or percentages need limits.
- Two dropdowns depend on each other, such as country then city.
- For making problems visible after the fact, use `use_skill` with `conditional-formatting`.
- For designing the tracker the rules go into, use `use_skill` with `tracker-sheet`.

## Steps

1. List the entry cells with the user: sheet, columns and what each should hold. Use `read_file` or `run_command` to look at the existing values in those columns. Existing data often shows the real set of values and the bad ones.
2. Decide the rule type per column: list, whole number, decimal, date, time, text length or custom formula. Write the allowed values or limits as a sentence before building anything.
3. Put list items on a `Lists` sheet, one column per list, with a header. Make the list a named range or table column so the dropdown follows additions. Avoid typing items into the rule itself for anything that may change.
4. Write the formulas for custom rules and test them mentally on three values. Examples: an end date not before the start date, an ID that is unique in its column, text that matches a pattern. Use relative references that anchor to the first cell of the range.
5. Dependent dropdowns: use a lookup or an indirect reference to a named range that is chosen by the first cell. Document how a new parent value is added.
6. Set the messages. An input prompt tells people what to enter, and the error alert says what was wrong and what is allowed. Use stop for hard rules, warning where an exception is legitimate, and information for hints.
7. Clean the existing data. Use `run_command` to find cells that already break the new rule, list them, and fix or flag them, since validation does not check old values.
8. Test with a typed bad value, a pasted bad value and a deleted value. Report which of those the rule stops.
9. If writing the workbook file, set the rules with a library through `run_command` or `write_file` and reopen it to confirm they are present. Otherwise give the exact menu steps for the user's application.
10. Document the rules where users will find them.
   - Add a small notes sheet listing each validated column and what it accepts.
   - Say who owns each list and how a new item is approved.
   - Note any column left open on purpose, with the reason.
   - Add a count of cells that currently fail, so drift is visible.

## Gotchas

- Pasting a cell over a validated cell replaces the rule or inserts any value. Validation guides typing, and it is not a lock. For real control, protect the sheet or use a form.
- A list typed into the rule with commas breaks when an item contains a comma, and in some regional settings needs a semicolon.
- Blank is allowed by default. If the field is required, the rule alone does not enforce it, so add a check column.
- Renaming a list item does not update the cells already using it. Cleaning the old value is a separate step.
- Merged cells and tables that grow can lose the rule on new rows. Apply it to the whole column range or the table column.
- Dropdown arrows hide on cells that are not selected. Users who do not know a list exists will type freely, so the prompt message matters.

## Output

- The notes sheet content and the count of cells failing now.
- A table of column, rule, source and message.
- The list sheet layout and how to add a new item.
- The test results and existing values that break the rule.
