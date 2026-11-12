---
name: data-analysis
description: Analyses tabular data such as CSV files, spreadsheets and exports. Checks quality, computes statistics exactly, finds patterns and explains what they mean without overclaiming. Use when the user shares data and asks for analysis, trends, totals, comparisons, outliers or insights.
---

# Data analysis

## Goal

Answer the user's question from their data with numbers that were computed, not estimated, and say how far those numbers can be trusted. A good result leads with the answer, backs it with a small table, and names the data problems it ran into.

## When to use

- The user shares a CSV, spreadsheet or export and asks what it shows.
- The user wants totals, averages, group comparisons, trends or outliers.
- If the data is messy and needs tidying first, use `use_skill` with `csv-cleaner`.

## Steps

1. Understand the data. Use `read_file` on the file and establish what each column means, its type and units, and what one row represents. Find the question the user wants answered. If it is open ("what do you see?"), look for totals, trends over time, differences between groups, outliers and missing data. Note the size, the date range and obvious quality problems: missing values, duplicates, inconsistent spellings ("NY", "New York"), numbers stored as text, mixed units.
2. Compute exactly. Write a short program and run it with `run_command` (Python with only the standard library, such as `csv` and `statistics`, unless a package is known to be installed), or save a script and run it with `run_command`. Print the results you will report. If programs cannot run, compute step by step in your reasoning and show the working for key figures. For large datasets, say that exact results need a program or a spreadsheet, and give the formulas.
3. Analyse:
   - Describe with counts, sums, means and medians (medians for skewed data such as prices or incomes), minimum and maximum.
   - Compare groups with both absolute and relative differences.
   - For trends, give change over time as percentages.
   - Mention sample sizes.
4. Report in this order: the answer in plain words with the key numbers, a small summary table, notable patterns and outliers (possible explanations marked as such), data quality issues and how they were handled, then suggested next analyses or data that would help.
5. Offer to save cleaned data or result tables as .xlsx or .csv, written with `create_file` or `write_file`.

## Gotchas

- Never estimate a number you can compute.
- Correlation is not causation. Say what else could explain a relationship.
- Short periods and seasonality distort trends. Be careful before calling a two-month rise a trend.
- Small groups give unstable percentages. Show the group size next to each figure and treat small ones with caution.
- Means mislead on skewed data. Report the median beside it.

## Output

The answer first, with key numbers, then a summary table, patterns and outliers, data quality notes and next steps. Keep explanations marked as hypotheses when the data cannot confirm them.
