---
name: merge-and-split-pdf
description: Merges, splits, extracts and reorders PDF pages using a page map the user confirms before any file is written, and never overwrites the source. Use when the user asks to merge PDFs, split a PDF into parts, pull out pages, or reorder or rotate pages.
---

# Merge and split PDF

## Goal

Produce new PDF files with exactly the pages the user wants in the order they want, while the originals stay untouched. A good result comes with a page map the user saw first and a check that the page counts add up.

## When to use

- Combining several PDFs into one, in a given order.
- Splitting one PDF by chapter, by page ranges or every N pages.
- Extracting, deleting, rotating or reordering pages.
- For assembling a full meeting pack with an index, use `use_skill` with `meeting-pack-assembly`.
- For other PDF work such as forms or watermarks, use `use_skill` with `pdf`.

## Steps

1. Inventory the inputs with `list_directory`. For each PDF get the page count and whether it is encrypted, using `run_command` with a PDF library or `run_command` with a PDF tool that is installed. Check availability before assuming one.
2. Resolve encryption. A file with an open password needs it from the user via `ask_user`. Do not try to break protection.
3. Write the page map as a plain table: output file, source file, source pages, rotation. Use the PDF's real page index, counted from the first sheet, not the number printed on the page. Show the map and the expected page count of each output.
4. Get approval with `ask_user`, especially for the order and for any pages dropped.
5. Create the outputs in a new folder or with a new name, such as `name_merged.pdf` or `name_part1.pdf`. Never save over a source. Use `run_command` to do the operation.
6. Verify each output: page count equals the plan, first and last page match the source pages by text sample, and the file opens. Check file size against the sum of the inputs.
7. For splits by chapter, find boundaries from the outline or the table of contents rather than guessing, and show the chosen boundaries before cutting.
8. Report the output paths and sizes. Offer to compress only if the size is a problem, and say that compression may lower image quality.
9. Offer follow-ups only when they fit what the user wanted.
   - Add page numbers or a stamp if the merged file is meant for printing or filing.
   - Name the outputs with a convention if there are many parts, such as `part01` to `part12`.
   - Suggest keeping the page map file so the same operation can be repeated.
   - Remind the user that sources remain where they were, and can be deleted when the user is satisfied.
10. If any output is over a size limit the user mentioned, say so and offer options.

## Gotchas

- Printed page numbers and PDF page indexes differ when there are cover pages or roman numeral front matter. The user says page 5, the file means index 9. Confirm which one.
- Merging drops or breaks bookmarks, internal links and form fields in many tools. Tell the user what was lost, and rebuild bookmarks if they are needed.
- Mixed page sizes and orientations print badly. Report them instead of silently scaling.
- Splitting a signed PDF invalidates the signature. Say so before doing it.
- Pages that are scans of a rotated sheet carry a rotation flag, not rotated pixels. Extracting without the flag shows them sideways.
- A split by "every N pages" cuts through the middle of sections. If sections matter, split on the outline instead.

## Output

- The page map file path, if one was saved.
- The page map and the list of files written with page counts and sizes.
- A note on anything lost or changed: bookmarks, links, form fields, signatures.
- The untouched sources named as such.
