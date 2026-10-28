---
name: file-organizer
description: Sorts a messy folder into a clean structure by proposing a plan first, showing a dry-run list of moves, and applying it only after approval. Use when the user asks to clean up a downloads folder, organise files, or sort a directory by type, date or project.
---

# File organizer

## Goal

Turn a pile of loose files into a structure the user can navigate, without losing or overwriting anything. A good result is a short folder scheme, a move list the user approved, a log of what moved where, and nothing left behind by accident.

## When to use

- The user wants a downloads, desktop or project dump folder tidied.
- The user wants files grouped by type, date, client or project.
- For renaming files by a rule, use `use_skill` with `batch-rename`.
- For removing copies, use `use_skill` with `duplicate-file-finder`.
- For designing the naming rule itself, use `use_skill` with `filename-convention`.

## Steps

1. Scope it. Use `ask_user` if the target folder is unclear, and confirm that subfolders are in or out of scope. Never start in a system folder, a home directory root, or a folder that holds a git repository or app install.
2. Survey. Use `list_directory` on the folder, then `run_command` for a count by extension and the oldest and newest modified dates. Note the 20 largest files, since they often decide the scheme.
3. Spot units that must stay together: a folder with a project file plus assets, a set of files with the same stem (`report.docx` and `report_files/`), photo sets with sidecar files. Treat each as one item.
4. Propose a scheme of at most two levels, such as `Documents/2025`, `Images`, `Installers`, `Archives`, `To-review`. Pick the axis (type, date or project) from what the files show and what the user said. Show the scheme and a count per target folder.
5. Build the dry run with `run_command` (or `run_command`): a table of source path, target path, and a reason. List collisions where two files would land on the same name. Write the table to a file with `create_file` in the folder's parent, not inside it.
6. Use `ask_user` to get approval of the scheme and the table. Ask about the odd files you could not place.
7. Apply with `move_file`, or one `run_command` loop for large counts. Never overwrite: on a collision, append a counter to the incoming name. Append every move to a log file as `old path -> new path`.
8. Verify. Use `list_directory` on the result and compare the file count with the survey. Report the count of items moved, skipped and left in `To-review`.
9. Hand over the maintenance rule so the folder stays tidy after you leave.
   - Suggest one inbox folder where new files land, and a monthly five-minute sort.
   - Name the two or three rules that decided placement, so the user can repeat them.
   - Offer to save the scheme as a short text file in the root, with the date it was set.
   - Do not schedule anything or add automation unless the user asks.
10. Check that no empty folders were left from the moves, and offer to remove them.

## Gotchas

- Moving before approval turns a tidy-up into an incident. The dry run is the product, the move is the cheap part.
- Same-named files from different days collide silently on some shells. Check targets for existence, do not trust the tool to refuse.
- Files modified recently may be open in another program. Skip anything changed in the last few minutes and say so.
- Installers, `.lnk` shortcuts and project folders with relative paths break when moved. Leave them or move them as a whole unit.
- A deep scheme (type, then year, then month, then client) has more folders than files. Two levels is the cap.
- Cloud-synced folders (OneDrive, Dropbox) treat a move as delete plus upload. A big reshuffle can queue for hours and trigger conflicts on other devices.

## Output

- The one-paragraph rule for where new files should go.
- The proposed scheme with counts, then after approval a short report: moved, skipped, collisions renamed.
- The path of the move log and the one-line command or steps to undo it.
- A list of files left in `To-review` with a reason for each.
