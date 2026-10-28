---
name: data-quality-audit
description: Checks a dataset for completeness, validity, uniqueness, consistency and freshness against stated rules, and reports each problem with a count and example rows. Use when the user asks to check the quality of data, whether data is reliable, or to audit an export before it is used.
---

# Data quality audit

## Goal

Give the user an evidence-based statement of how far a dataset can be trusted for a particular purpose. A good audit lists rules, runs each one, reports failures with counts and examples, and ranks the problems by their effect on the intended use. It does not fix anything unprompted.

## When to use

- A data export or feed is about to be used for a report, model or decision.
- Numbers from two systems disagree and the user suspects bad data.
- A new data source is being accepted into a pipeline.
- For cleaning the problems found, use `use_skill` with `csv-cleaner`.
- For judging unusual values on their own, use `use_skill` with `outlier-detection`.

## Steps

1. Ask what the data will be used for and who owns it. Quality is relative to purpose: a missing phone number matters for outreach and not for revenue analysis. Use `ask_user` if the purpose is unstated.
2. Load the data with `run_command` and record the baseline: rows, columns, date range, source file and modified date. Save the file hash so the audit refers to exactly this version.
3. Write the rules before running them, grouped by dimension, and show them to the user:
   - Completeness: required columns with no blanks, expected row count per period.
   - Validity: types, formats, ranges, allowed codes (an age between 0 and 120, a country code in the list).
   - Uniqueness: keys with no duplicates, no repeated records under another key.
   - Consistency: fields that must agree (end after start, total equals sum of parts, same customer same country).
   - Timeliness: latest date is recent enough, no missing days.
4. Run each rule with `run_command` and collect the count of failing rows, the percentage and three example rows. Keep the failing row indexes in a file.
5. Cross-check against a control total from outside the file, such as a row count or revenue figure from the source system, if the user has one.
6. Look for silent problems that pass every rule: a column that is identical on all rows, placeholder values like `N/A`, `0000-00-00` or `9999`, a sudden change in the share of blanks over time.
7. Rank the failures by impact on the stated purpose: affects the result, affects a segment, cosmetic. Estimate the effect where you can, for example "dropping these rows changes the total by 3 percent".
8. Write the report with `create_file`: scope, rules, results table, ranked issues, and the failing-row files. Use `use_skill` with `data-dictionary` if the field meanings were unclear.
9. Propose fixes and who decides each: fix at the source, fix in the pipeline, exclude, or accept with a note. Do not apply any without agreement.

## Gotchas

- A data set can have zero nulls and still be wrong, because blanks were replaced with zeros or placeholders upstream. Look at value frequencies for 0, -1, 999 and "unknown".
- Rules invented by the auditor and not agreed with the owner produce arguments. Confirm the allowed ranges and codes first.
- Percent failing hides scale. One percent of ten million rows is a hundred thousand records, so report both.
- Checking after a join or filter can mask problems in the original. Audit the raw file as delivered.
- Fixing while counting changes the numbers you report. Count first on the untouched data.

## Output

- A one-paragraph verdict for the stated purpose: usable, usable with exclusions, or not usable.
- The rule results table with counts, percentages and examples.
- The ranked issue list with a suggested owner and fix for each, and the path of the failing-row files.
- The checks run, with the code or query path so the audit can be repeated on the next extract.
