---
name: tracker-sheet
description: Designs a tracker sheet for tasks, orders, leads or any list of items, with a status list, owner, dates and summary counts that keep working as rows are added. Use when the user asks for a task tracker in a spreadsheet, a way to track orders or leads, or a simple CRM sheet.
---

# Tracker sheet

## Goal

Give the user one table where every item has one row, one owner and one status, plus a small summary that is always right. A good tracker can be used by someone who did not build it, and does not break when a row is added, sorted or filtered.

## When to use

- Tracking tasks, bugs, orders, leads, applications, assets or events.
- Replacing a chat thread or an email chain with a shared list.
- Fixing a tracker whose summary no longer matches its rows.
- For restricting entries to lists and dates, use `use_skill` with `data-validation-rules`.
- For highlighting overdue or blocked items, use `use_skill` with `conditional-formatting`.

## Steps

1. Ask with `ask_user` what the items are, who updates the sheet, how many items to expect, and the three questions the sheet must answer. Typical ones: what is open, what is late, who has the most work.
2. Choose the columns, as few as possible. Start with an ID, a title, an owner, a status, a priority or type, a created date and a due date, then add what the questions need. Put one fact in each column.
3. Define the status list with the user, in order: for example New, In progress, Blocked, Done. Write what each one means in one line, and put the list on a `Lists` sheet. Add a closed date that is filled when the status becomes Done.
4. Build the main table as a proper table object so formulas and formatting extend to new rows. No merged cells, no blank rows, no header repeated in the middle, one header row at the top and frozen.
5. Add an ID that is stable: a running number or formula-generated code that does not change when rows are sorted. Do not use the row number.
6. Add computed columns as formulas: age in days, days to due date, an overdue flag that ignores closed items. Keep them to the right and visually distinct from input columns.
7. Build the summary on its own sheet or at the side: counts by status with COUNTIFS, open items per owner, items due this week, overdue count. Reference whole table columns, not fixed ranges.
8. Add the entry helps: dropdowns for status, owner and priority, date validation, and a short instruction row or note.
9. Test by adding a row at the bottom, sorting by owner, filtering to one status and marking an item Done. The summary must stay right after each action.
10. Provide the sheet with `write_file` through the file route if asked, or give the layout and formulas.
11. Agree the habits that keep it alive.
   - Name who triages new rows and how often, such as every Monday.
   - Archive closed items to an `Archive` sheet each quarter, keeping their IDs.
   - Decide whether comments go in a column or in the cell notes, and use only one.
   - Review the sheet with the team after a month and cut unused columns.

## Gotchas

- Free-text status values (`done`, `Done`, `finished`) split the counts. A list is the cure, applied from the first row.
- A summary built on a fixed range like `A2:A200` stops counting at row 200 without any warning.
- Sorting a range that has formulas pointing at other rows can scramble references. Use table structured references or keep row-wise formulas inside the same row.
- Several people editing one local file produces conflicting copies. If it is shared, use a cloud sheet and say so.
- Adding a column for every new need makes a sheet nobody fills in. Ask which columns are used after a month and remove the rest.
- Deleting a row breaks ID continuity and any outside reference to it. Mark items cancelled instead of deleting them.

## Output

- The team habits agreed in step 11, in a few lines.
- Column list with a one-line purpose each, and the status definitions.
- The summary formulas and where they live.
- The tests passed and the rules for the people who will use it.
