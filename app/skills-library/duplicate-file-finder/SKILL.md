---
name: duplicate-file-finder
description: Finds exact duplicate files by size and content hash, groups them, and proposes which copy to keep before anything is removed. Use when the user asks to find duplicate files, free up disk space, or check which photos or documents are the same.
---

# Duplicate file finder

## Goal

Find files with identical content, group them, and recommend one copy to keep per group with a stated reason. A good result reclaims space without deleting the only good copy, and the user decides every removal.

## When to use

- The user suspects copies across a photo library, downloads or a document archive.
- The user wants to free space and asks what is safe to delete.
- For near duplicates, such as resized photos or two edits of one document, say that this skill matches exact content only. For document versions use `use_skill` with `document-comparison`.
- For structural cleanup after removal, use `use_skill` with `file-organizer`.

## Steps

1. Confirm the folders to scan and what is out of scope. Use `ask_user` if more than one root is involved. Never scan system folders, app install folders or a folder with a `.git` directory.
2. Group by size first with `run_command`, since files of different sizes cannot match. Drop groups of one. Skip empty files, which all match each other.
3. Hash only the remaining candidates with SHA-256, reading in chunks. For very large files, hash the first and last megabyte first, then the full file only for those that still match.
4. Build groups. For each group list path, size, modified date and folder. Confirm with a full hash, never with name or date alone.
5. Pick a suggested keeper per group by a stated rule: the copy in the best-organised folder, then the oldest modified date, then the shortest path. Mark the rest as removal candidates.
6. Write the report with `create_file` as a CSV: group id, path, size, keep or remove. Show the total reclaimable space and the ten largest groups in the chat.
7. Ask with `ask_user` how to proceed: delete candidates, move them to a `_duplicates` folder, or leave everything. Prefer the move. Only delete when the user says so for this run.
8. After acting, run the scan again on the same roots and confirm the group count dropped as expected. Keep the CSV as the record.
9. Give the user the safe path to recovery.
   - If files were moved, keep the `_duplicates` folder for a stated period, such as 30 days.
   - Say where the CSV lists each moved file's original location.
   - Do not empty the recycle bin or run any permanent delete yourself.
   - Offer a repeat scan next time as a quick count, not a clean-up.
10. Note any groups the user chose to keep and record the reason in the CSV.

## Gotchas

- Same name does not mean same content, and different names can hold identical bytes. Compare hashes, not names.
- Hardlinks and symlinks show up as duplicates but free no space when removed. Check link counts, and skip symlinks.
- Photos exported twice with different metadata differ in bytes, so they will not match. Say this instead of promising a full clean-up.
- A "copy" inside a synced cloud folder may be the only local copy of an online-only file. Check sync status before removing anything there.
- The keeper rule matters more than the finder. A folder named `Backup` or `Old` is not automatically the one to drop.
- Hashing a large library reads every candidate byte. On a slow external drive that takes long, so give an estimate before starting.

## Output

- A line saying the match is exact content only.
- Counts: files scanned, duplicate groups, reclaimable space.
- The path of the CSV report and the top groups in a short table.
- The action taken, or the options still waiting on the user.
