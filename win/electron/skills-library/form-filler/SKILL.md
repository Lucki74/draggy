---
name: form-filler
description: Fills a PDF or document form from data the user supplies, lists every field left blank or uncertain, and never guesses values. Use when the user asks to fill in a form, complete an application, or populate form fields from a data file.
---

# Form filler

## Goal

Fill the form with the facts the user gave and nothing else. A good result has every field accounted for in a table: filled from which source, left blank, or needing a decision. The user submits or signs the form, not the agent.

## When to use

- A fillable PDF, a Word form or a scanned form needs to be completed from known details.
- The same form must be filled for several people or records.
- For generating many letters from a template, use `use_skill` with `docx-template-fill`.
- For general PDF editing beyond forms, use `use_skill` with `pdf`.

## Steps

1. Examine the form. Use `run_code` or `run_command` to list the fillable fields with name, type and options (text, checkbox, radio group, dropdown). If there are no fields, it is a flat document, and you will need to overlay text at coordinates or fill a Word version instead.
2. Collect the data. Read the file the user provided with `read_file`, or ask with `ask_user`. Record where each value came from.
3. Map data to fields in a table: field label, field name, value, source. Read the printed label on the page, since internal field names like `Text14` say nothing.
4. Mark gaps. A field with no supplied value stays blank and is listed. Do not infer a date of birth, income, an ID number, a signature or a declaration answer.
5. Normalise to what the form expects: date order, phone format, country names from the dropdown list, uppercase if the form says block capitals. Check maximum lengths and comb fields.
6. Show the mapping table and the gap list with `ask_user`. Ask about yes or no declarations one by one if they were not supplied.
7. Write the filled copy under a new name with `run_code` or `run_command`, never over the blank original. Set fields by exported value for checkboxes and radios.
8. Verify by reading the fields back from the output and comparing with the table. If possible render a page and look at it for overflowing text.
9. For a batch of forms, repeat with discipline.
   - Fill the first record, get the user to inspect it, then run the rest.
   - Produce one output file per record, named from a key such as surname and date.
   - Collect all blank-field warnings into one table instead of many messages.
   - Stop the batch on the first structural error, such as a field that no longer exists.
10. Keep the mapping table so the same form can be filled again later.

## Gotchas

- Checkboxes and radio groups have an internal on value, such as `Yes`, `1` or `On`, which is not the label text. Read the allowed states before setting one.
- Some viewers show stale field appearance until the file is flattened or the appearance stream is regenerated. Test by reading it back and by rendering.
- Sensitive items (ID numbers, bank details, health or immigration answers) go in only if the user supplied them for this form. Do not reuse values from other files.
- Never sign, tick a declaration of truth, or submit online. Leave those to the user and say so.
- Flattening a form removes the ability to edit. Keep an unflattened copy.
- A form version changes field names between years. A mapping saved for last year's form may point at the wrong field now.

## Output

- Which fields were set by rule (a format change) and which came from data as given.
- The path of the filled copy and the unfilled original, named as such.
- The mapping table, then a short list of blank and uncertain fields with what is needed.
- A reminder of the steps only the user can do, such as signing and submitting.
