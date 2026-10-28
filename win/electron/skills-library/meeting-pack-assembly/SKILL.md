---
name: meeting-pack-assembly
description: Collects an agenda, papers and prior minutes into one ordered meeting pack with a cover, index and consistent page order, after checking for stale versions. Use when the user asks to put together a board pack, assemble meeting papers, or compile files for a meeting.
---

# Meeting pack assembly

## Goal

Produce one pack a reader can open and follow in agenda order, with the latest version of every paper and an index that shows where each starts. A good pack is the right size to send and has been checked against the agenda item by item.

## When to use

- A recurring board, committee, team or client meeting needs its papers combined.
- The user has a folder of mixed files (docx, pdf, slides) for one meeting.
- For merging or splitting plain PDFs without an agenda, use `use_skill` with `merge-and-split-pdf`.
- For writing the agenda or minutes themselves, ask the user to describe them or use `use_skill` with `docx`.

## Steps

1. Find the inputs. Use `list_directory` on the meeting folder and read the agenda with `read_file`. Ask with `ask_user` for the agenda if it is not in the folder.
2. Build a checklist table: agenda item number, title, expected paper, file found, modified date, status. Mark items with no file and files that match no item.
3. Detect version problems. Group files by stem (`budget_v2`, `budget_final`, `budget_final2`) and show the candidates with dates. Ask the user which is current for each group. Never pick by the word "final".
4. Convert non-PDF files to PDF with `run_command` if a converter is installed (check first). Tell the user about files you could not convert and ask what to do.
5. Order the files by agenda number. Put the cover, agenda and previous minutes first. Add separator pages or bookmarks per item if the user wants them.
6. Create the index: item number, title, start page. Compute start pages from the page counts of each converted file, plus the cover and index pages themselves. Build the pack with `run_command` and write it under a new name.
7. Verify. Page count equals the sum of parts. Open three item start pages by text sample and compare with the index. Check the file size, since email limits are often 10 to 25 MB. Compress only with the user's consent.
8. List what is in and what is missing, and keep the checklist beside the pack for the next cycle.
9. Prepare for the next cycle and for late changes.
   - Save the build steps and the checklist as a small text file in the meeting folder.
   - Record the order, the version choices and the exclusions, so the rebuild repeats them.
   - Name the pack with the meeting date and a version, such as `board-pack_2025-06-12_v1`.
   - If a late paper arrives, rebuild from the steps and increase the version, never edit the sent file.
10. Draft a two-line cover note listing what is in the pack, only if the user asks for it.

## Gotchas

- The index must account for its own pages. Build twice if needed: once to learn the index length, once to place the numbers.
- Confidential items (in-camera or restricted papers) may need to be left out of the general pack. Ask who receives it.
- Converted slides print one per page at tiny text. Ask whether to print handouts with several per page.
- Late papers arrive after the pack is built. Keep the build steps in a small file so the pack can be rebuilt in a minute.
- A scanned paper has no searchable text. Say which ones, since the reader cannot search them.
- Documents with their own page numbers inside a pack with its own numbering confuse readers. Refer to the pack page in the index and keep the originals visible.

## Output

- The version name of the pack and the date it was built.
- The pack path, page count, size and the index in the reply.
- The checklist with any missing papers and the version choices made.
- A short note on anything converted, compressed or excluded.
