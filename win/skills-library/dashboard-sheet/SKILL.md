---
name: dashboard-sheet
description: Builds a one-page dashboard inside a workbook, with KPI tiles and a few charts fed by a separate data sheet and a calculation sheet. Use when the user asks for a dashboard in Excel or Sheets, a one-page summary of their data, or a KPI sheet with charts.
---

# Dashboard sheet

## Goal

Give a reader the answer to a few questions in under a minute, from a single sheet that updates when the data does. A good dashboard has three to six numbers, two to four charts, nothing typed by hand, and a visible date for when the data was last refreshed.

## When to use

- The user wants a summary page over a data sheet in the same workbook.
- A manager wants to see status, trend and exceptions without opening the data.
- For a dashboard in a web page or app, write a short spec of questions and metrics first, then build it in code.
- For the pivot behind a chart, use `use_skill` with `pivot-table-design`.

## Steps

1. Ask with `ask_user` who reads it, how often, and the three decisions it should support. List the questions as sentences: "Are we on target this month? Which region is behind?"
2. Inspect the data with `read_file` or `run_command`: columns, row count, date range and the grain of a row. Confirm that the questions can be answered from it. If they cannot, say what is missing.
3. Split the workbook into three layers: a `Data` sheet (raw, untouched), a `Calc` sheet (summaries and helper ranges, all formulas), and the `Dashboard` sheet (references to Calc only). Name them so.
4. Define each KPI exactly: formula, period, comparison. For example "revenue this month versus the same month last year". Write the definition in a small note under the tile. Agree disputed definitions with the user before building.
5. Build the Calc ranges first with formulas or pivot tables, and test them against a manual sum of the data. Use bounded named ranges or a table so new rows are included.
6. Place the tiles top left, the trend chart next, the breakdown chart below, and exceptions or a short table last. Use one font, two colours plus a highlight, and a consistent number format with units in the label.
7. Add one control at most: a dropdown for period or region driving the Calc formulas. Make the default view the most common one.
8. Add the footer: data source, refresh date from a formula such as the max date in the data, and the owner name.
9. Check the print layout: set the print area and fit to one page, landscape. Open it at the width of the user's screen and make sure nothing sits off the visible area.
10. Test by adding a dummy row to Data and confirming every tile moves, then remove it.
11. Hand over with maintenance notes.
   - Say how new data is added: paste below the last row of Data, or replace the sheet.
   - Say how to change the period or add a KPI, in two or three clicks or lines.
   - Protect the Dashboard and Calc sheets from accidental edits, leaving the controls open.
   - Keep one hidden-free workbook, so the reader can see every sheet that feeds the numbers.

## Gotchas

- Typing a number into a tile "just this once" hides the formula and the next refresh shows a stale value. Every number must be a formula.
- More charts do not mean more insight. Each chart needs a question it answers, and a title that states the finding.
- Charts bound to fixed ranges miss new rows. Use table ranges or dynamic named ranges.
- Colour alone is lost on a grey printout or for colour-blind readers. Add labels, signs or icons.
- Mixing units in tiles, such as thousands in one and units in another, produces wrong readings. State units in each label.
- A dashboard that opens on last month's view because a control was left set is read as current. Reset controls to the default before saving.

## Output

- The maintenance notes, in four lines or fewer.
- The layout described by area, with the KPI definitions and chart list.
- The sheet structure and where each formula lives.
- The test performed and the known limits of the data.
