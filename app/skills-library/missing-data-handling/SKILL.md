---
name: missing-data-handling
description: Diagnoses why values are missing and chooses to drop, flag or fill them under a stated rule, showing how the choice changes the results. Use when the user asks what to do with blanks, how to fill missing values, or says nulls are skewing an average.
---

# Missing data handling

## Goal

Treat gaps in a way that fits why they happened and that the reader can see. A good result measures the extent of the missing data, explains the likely mechanism, applies a rule that suits the purpose, and shows the headline numbers under at least two treatments so the sensitivity is known.

## When to use

- Columns have blanks, nulls, placeholders like `-1` or `N/A`, or whole periods missing.
- An average or model changes when rows with gaps are dropped.
- The user wants to fill values for a tool that cannot take blanks.
- For a wider data check, use `use_skill` with `data-quality-audit`.
- For cleaning text and formats in a file, use `use_skill` with `csv-cleaner`.

## Steps

1. Find all the ways missing shows up. Use `run_command` to count true nulls, empty strings, and the frequency of suspicious codes (0, -1, 99, 999, "unknown", "none", 1900-01-01). Convert the placeholders to real nulls and record which were converted.
2. Measure the extent: share missing per column and per row, and the number of rows complete across the columns you need. Sort columns by missing share and look at the pattern in a heat map or table.
3. Ask why with the owner of the data. Use `ask_user`. Was the value not collected, not applicable, refused, lost in transfer, or a true zero? The answer decides the treatment.
4. Classify the mechanism as best you can:
   - Missing completely at random: unrelated to anything, rare in practice.
   - Missing at random: related to other observed columns (older records lack a field).
   - Missing not at random: related to the value itself (high earners skip the income question).
   Test by comparing other columns between rows with and without the value.
5. Pick a treatment for the purpose:
   - Drop rows when the share is small and the mechanism is plausibly random, and say how many were dropped.
   - Drop a column when most of it is missing and it is not needed.
   - Add a missing flag column and fill with a neutral value, when missingness itself carries information.
   - Fill with the median or a group median for a quick baseline, accepting the cost to variance.
   - Model-based or multiple imputation when the analysis is important and the share is large.
   - Carry forward the last value only for state that holds until it changes, such as a price.
6. Never use zero for missing in a numeric column, as it changes averages and totals. Keep the null and let the calculation skip it, or flag it.
7. Compare results under the treatments: the mean, the total and any model coefficient with rows dropped, filled and flagged. Put the table in the report with `create_file`.
8. Document the rule in the code or notebook, with the counts affected, so a rerun on new data does the same thing.

## Gotchas

- Mean filling shrinks the spread and weakens correlations, so a model sees tidier data than exists. Use it only for a rough baseline.
- Dropping every row with any missing value can remove most of the data, and the survivors may be an unusual group.
- A blank in a count column can mean none or unknown. Treating both as zero changes totals.
- When missingness depends on the outcome, no filling method repairs it. State the limit of the conclusion.
- Filling before splitting into training and test data leaks information. Compute fill values on the training part only.

## Output

- A missingness table: column, share missing, placeholders converted, likely mechanism.
- The treatment chosen per column with a reason.
- The sensitivity table for the headline figures, and the path of the code that applies the rule.
