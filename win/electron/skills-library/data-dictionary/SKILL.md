---
name: data-dictionary
description: Documents each field of a dataset with meaning, type, units, allowed values, source and known quirks, flagging what had to be guessed. Use when the user asks to document a dataset, write a data dictionary, or says nobody knows what the columns mean.
---

# Data dictionary

## Goal

Give anyone who picks up the dataset the facts they need to use it correctly without asking around. A good dictionary describes each field by what the field means, with the name as a starting point, includes units and codes, notes known problems, and separates what is confirmed from what is inferred.

## When to use

- A dataset is being handed to another team or archived.
- Columns have cryptic names, codes or flags that new users misread.
- Before analysis, to avoid wrong assumptions about fields.
- For scoring how clean the data is, use `use_skill` with `data-quality-audit`.
- For defining the meaning of a business metric built from fields, use `use_skill` with `metric-definition`.

## Steps

1. Identify the dataset: name, owner, source system, how and when it is produced, the grain (one row per what), the time range and the refresh pattern. Use `ask_user` for what you cannot find in the files, and read any existing README with `read_file`.
2. Load the data with `run_command` and list every column with its dtype, share of nulls, number of distinct values, min and max or the top values. This is the factual skeleton of the dictionary.
3. For each column write the description by looking at the values as well as the name. Show five real examples. Find the unit (currency and whether it includes tax, grams or kilograms, UTC or local time), the precision and the range.
4. For coded fields (status 1 to 5, country codes, flags) list every code with its meaning. If the meaning is not known, write "unknown" and ask the owner. Do not guess from the label.
5. Identify the keys: the primary key, the foreign keys and the tables they join to. Check the uniqueness claim with `run_command` before writing it.
6. Record quirks found in the profile: placeholder values such as 9999, a column filled only after a certain date, a field that changed meaning, duplicated information in two columns, free text with inconsistent spelling.
7. Mark derived fields and give the formula, and note fields that hold personal or sensitive information, with the handling the owner requires.
8. Mark the confidence of each entry: confirmed by the owner, observed in the data, or inferred. Collect all the inferred ones in a short list of questions for the owner.
9. Write the dictionary as a table in a Markdown or CSV file with `create_file`: field, type, description, unit, allowed values or codes, nulls, example, notes, confidence. Keep a change log line with the date.
10. Re-run the profile against the finished dictionary to be sure no column is missing and every stated range matches the data.

## Gotchas

- Column names mislead: `date` may be created, updated or posted. Check against other fields and the owner before writing it.
- Units left implicit cause the worst errors, such as cents read as dollars or milliseconds as seconds.
- A code list copied from an old document may be out of date. Compare it with the values that actually occur, and report codes that appear with no definition.
- A dictionary written once and never updated is trusted long after it is wrong. Record the date and the version of the data it describes.
- Descriptions that repeat the name ("customer id: the ID of the customer") add nothing. Say how it is created and where it joins.
- Fields renamed between extracts break old dictionaries. Compare column lists at each refresh.
- Access rules differ by field. Record which fields need approval to share.

## Output

- The dataset header block and the field table, saved as a file.
- The list of inferred entries and questions for the owner.
- The quirks and sensitive fields noted, with the dictionary's date and version.
- The version or extract date of the data the dictionary describes.
- The path of the profile output used to build it.
- Any column present in the data but absent from the dictionary, with a reason, or a statement that none exist.
