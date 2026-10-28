---
name: batch-rename
description: Renames many files by a rule using a preview table, collision checks and an undo log. Use when the user asks to rename all files in a folder, add a date or prefix to filenames, replace spaces, change case, or number a set of files.
---

# Batch rename

## Goal

Apply one naming rule to a whole set of files so that every result is predictable, unique and reversible. A good result has the user looking at a before and after table before any file changes, and an undo file after.

## When to use

- The user wants a prefix, suffix, date, counter or case change on many files.
- The user wants spaces, accents or odd characters removed from names.
- The user wants names rebuilt from metadata, such as a photo date or a CSV column.
- For deciding what the rule should be, use `use_skill` with `filename-convention`.
- For moving files into folders, use `use_skill` with `file-organizer`.

## Steps

1. Pin down the rule in one sentence, with one worked example from a real file. Use `ask_user` if the rule has choices: date source (modified, created, or inside the file), counter width, case.
2. Collect the set. Use `list_directory` and decide whether subfolders are included. Exclude hidden files and anything the rule should not touch, such as `.git` or system files.
3. Compute the new names with `run_command` without touching the disk. Keep the extension out of the rule unless the user wants it changed. Produce a table: old name, new name, status.
4. Check the table for problems: two old names mapping to one new name, a new name that already exists and is not in the set, names over 200 characters, trailing dots or spaces, and reserved Windows names such as `CON` or `NUL`.
5. Show the first 15 rows, the last 5 and every row with a problem. Use `ask_user` for approval. State the total count.
6. Write the undo file first with `create_file`: one line per file, `new name -> old name`, or a small script that reverses it.
7. Apply with `move_file` per file or a single `run_command` loop. For a chain where one new name equals another old name, rename through temporary names in two passes.
8. Verify with `list_directory`: the count matches, no old names remain, and the undo file is saved next to the folder.
9. Test the undo before declaring victory.
   - Pick one renamed file and reverse it from the undo file by hand.
   - Confirm the original name returns exactly, including case.
   - Leave the undo file in place for at least the session.
   - If the rename depended on a data file, such as a CSV of new names, keep that too.
10. Report anything that looked odd in the set, such as two near-identical names or files with no extension.

## Gotchas

- Case-only renames (`Report.txt` to `report.txt`) fail or do nothing on case-insensitive disks. Go through a temporary name.
- Sorting by name before numbering gives `10` before `2`. Number after sorting naturally, or by the date the user cares about.
- Regex replacements that match the extension, like `.` or `\w+`, strip it. Operate on the stem and re-attach the extension.
- Creation dates change on copy. If the date matters, read it from the file itself, such as camera metadata, when it is present.
- Renaming files that other files link to (web pages, documents with linked images) breaks the links. Ask whether links exist.
- Sidecar files (`.xmp`, `.srt`, `.json` next to media) share a stem with their main file. Rename them as a pair or they lose their owner.

## Output

- The rule as written in one sentence, so the user can reuse it.
- The before and after preview, then after approval the count renamed and the path of the undo file.
- A short list of files skipped and why.
- Nothing about files outside the stated set.
