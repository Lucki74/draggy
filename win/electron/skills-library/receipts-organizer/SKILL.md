---
name: receipts-organizer
description: Sets up a folder and naming scheme for receipts and sorts an existing pile of files into it without deleting anything. Use when the user asks to organize receipts, sort financial documents, or set up a receipts folder.
---

# Receipts organizer

## Goal

Leave the user with receipts and paperwork in a tidy, searchable folder structure, with the originals intact and a short log of what moved. How long records must be kept varies by place and purpose, so the skill sets no retention period and tells the user to check the current rules with the official source or a professional.

## When to use

- The user has a messy folder of scans, photos and downloaded invoices.
- The user wants a scheme before the next year starts.
- Cleaning a whole drive of duplicates is a broader job than this skill covers.

## Steps

1. Ask with `ask_user` where the files are, what kinds exist (photos, PDFs, emails saved as files), the years covered, and whether personal and business papers are mixed.
2. Look at the folder with `list_directory`. Count files by type and year, and list a sample of names. Do not open private files beyond what is needed to name them.
3. Propose the structure: year, then month or category, for example a folder per year with subfolders by type such as household, medical, work and warranty. Keep it to two levels.
4. Propose the file name pattern: date first as year-month-day so names sort in order, then vendor, then a short note and the amount. Show three examples.
5. Ask the user to approve the structure and the pattern before moving anything.
6. Create the folders with `create_file` placeholders or by moving the first file into a new path.
7. Move files with `move_file` in small batches. Copy first if the user wants to keep the original layout. Never delete.
8. For files whose date or vendor cannot be read from the name, list them in an unsorted folder and ask the user.
9. Write a log with `create_file`: old path, new path, date moved. Offer it as a CSV.
10. Count the files before and after, and confirm the totals match.
11. Offer a short monthly routine: file new receipts the same day or once a week.
12. List files that need a human look, such as handwritten notes, and ask before renaming them.

## Gotchas

- Deleting originals. The task is sorting, not cleanup.
- Names that sort wrongly, such as day-month-year. Use year-month-day.
- Renaming files that other programs or accounting tools point to.
- Storing sensitive documents in a shared or synced folder without the user's say.
- Guessing a date from the file's modification time, which is often the download date.
- Setting a keep-or-discard rule. Ask the user to check how long each type must be kept.
- Mixing business and household receipts in one folder when they are needed separately later.
- Compressing photos so far that the amount becomes unreadable.

## Output

The agreed structure, the naming pattern, the number of files moved, the unsorted list and the log path. State that nothing was deleted.

Keep the log next to the folder so it is found later.
