---
name: pivot-table-design
description: Designs a pivot table from the question being asked, choosing rows, columns, values, filters and groupings, and fixes the source data so the totals are right. Use when the user asks to build a pivot table, summarise data by category or month, or says a pivot shows wrong totals.
---

# Pivot table design

## Goal

Turn a flat table into a summary that answers one stated question. A good pivot has a source range that is clean, fields placed for the question, the right aggregation for each value, and a check that its grand total matches the source.

## When to use

- The user wants totals, counts or averages by one or two categories, such as sales by region and month.
- An existing pivot gives odd numbers, blanks or counts where sums were expected.
- The user is deciding between a pivot and formulas. A pivot suits ad hoc slicing, formulas suit a fixed report layout.
- For a presentation sheet that sits on top of summaries, use `use_skill` with `dashboard-sheet`.
- For one-off conditional sums in a fixed layout, use `use_skill` with `spreadsheet-formulas`.

## Steps

1. State the question in one sentence with the user: "What was revenue by product line per quarter?" A pivot without a question becomes a wall of numbers. Use `ask_user` if the question is vague.
2. Inspect the source with `read_file` or `run_command`. Print the header row, the column types and the row count. Look for blank rows inside the data, merged cells, two-row headers, subtotal rows mixed in, and columns with mixed text and numbers.
3. Repair the source in a copy or on a cleaned sheet. One header row, one record per row, no gaps, no subtotals, one type per column. Turn the range into a named table so the pivot grows with new rows.
4. Map the question to fields: what to slice by goes in rows or columns, the number to aggregate goes in values, the scope limits go in filters or slicers. Keep columns to a field with few distinct values.
5. Choose the aggregation per value field on purpose: sum for amounts, count for records, distinct count for customers, average only with a count beside it. State when a field is text, since text defaults to count.
6. Group where it helps: dates into months, quarters or years, numbers into bands. Note that grouping changes the field and cannot be applied to a column with blanks or text dates.
7. Decide the layout: tabular form with repeated labels is easier to copy into other work. Turn off grand totals that mislead, and show values as percent of column or row total when shares are the question.
8. Reconcile. Compare the grand total with a plain SUM of the source column and the row count with the pivot's count. If they differ, find the filtered or excluded records before reporting.
9. If the user needs the file written, use `write_file` for a workbook through the xlsx route, or give the field placement as a list for them to build. Say how to refresh after the data changes.
10. Make the pivot readable for the next person.
   - Rename value fields to plain labels such as "Revenue" instead of "Sum of Amount".
   - Set number formats on the value fields, not on the cells, so they survive a refresh.
   - Sort the rows by the value when ranking matters, and by the natural order for months.
   - Turn off auto-fit column widths if the layout is pasted into a report.

## Gotchas

- Dates stored as text will not group, and numbers stored as text sum to zero. Convert first, then check with a count of numeric cells.
- A pivot is a snapshot. Adding rows or editing source cells changes nothing until refresh, and a fixed range misses appended rows.
- Averages of averages mislead. Average a rate by dividing summed numerators by summed denominators with a calculated field.
- Blank source cells become a "(blank)" bucket that quietly takes a share of the total. Fill or filter them on purpose.
- Pivots copied between workbooks keep a link to the old data. Check the source before sending one out.
- Slicers and filters hide data, and a total shown on a filtered pivot looks like the whole. Label the filter state next to the table.

## Output

- Any filter in force, written beside the numbers.
- The question, then the field placement as rows, columns, values, filters, with the aggregation named.
- The cleaning steps applied to the source and the reconciliation result.
- How to refresh, and what to watch when new data arrives.
