---
name: data-analysis
description: "Analyses tabular data such as CSV, spreadsheets and exports: cleans it, computes the right statistics exactly, finds patterns and explains what they mean without overclaiming. Use when the user shares data and asks for analysis, trends, totals, comparisons or insights."
---

# Data analysis

## 1. Understand the data

- What each column means, its type and units, and what one row represents.
- The question the user wants answered. If it is open ("what do you see?"), look for totals, trends over time, differences between groups, outliers and missing data.
- Size, date range, and obvious quality problems: missing values, duplicates, inconsistent spellings ("NY", "New York"), numbers stored as text, mixed units.

## 2. Compute exactly

Never estimate numbers you can compute.
- **In Code**, write and run a short program with run_code (python, using only the standard library such as csv and statistics, unless a package is known to be installed) or read the file and run a script with run_command. Print the results you will report.
- **In Chat**, where programs cannot run, compute step by step in your reasoning and show the working for key figures. For large datasets, say that exact results need the Code side or a spreadsheet, and give the formulas.

## 3. Analyse

- Describe: counts, sums, means and medians (medians for skewed data such as prices or incomes), minimum and maximum.
- Compare groups with both absolute and relative differences.
- Trends: change over time as percentages, being careful with short periods and seasonality.
- Correlation is not causation: say what else could explain a relationship.
- Mention sample sizes, and treat small groups with caution.

## 4. Report

1. The answer to the question, in plain words, with the key numbers.
2. A small summary table.
3. Notable patterns and outliers, with possible explanations marked as such.
4. Data quality issues found, and how they were handled.
5. Suggested next analyses or data that would help.

Offer to save cleaned data or result tables as .xlsx or .csv (in Chat with create_file; in Code with write_file into the project).
