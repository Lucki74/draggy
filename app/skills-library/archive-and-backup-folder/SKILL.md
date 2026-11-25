---
name: archive-and-backup-folder
description: Creates a dated archive or backup copy of a folder, keeps it away from the original, and verifies it by file count, size and checksum. Use when the user asks to back up a folder, zip a project for the archive, or make a safe copy before changing things.
---

# Archive and backup a folder

## Goal

Make a copy that can really restore the folder, stored somewhere that survives the loss of the original. A good result is a dated archive with a manifest, a verification that the contents match, and an honest note about what was left out.

## When to use

- Before a risky bulk change such as a rename, a clean-up or a migration.
- At the end of a project, to store a closed folder.
- A periodic copy of a working folder to another drive.
- For tidying the folder first, use `use_skill` with `file-organizer`.
- For source code under git, a commit or branch is usually the right backup. Ask before archiving a repository.

## Steps

1. Confirm the source and the destination with `ask_user`. The destination should be a different drive, a cloud folder or a network location, not a sibling in the same folder. If the user offers the same disk, say it protects against mistakes but not against disk loss.
2. Measure the source: file count, total size and the largest items, with `run_command`. Check free space at the destination and stop if it is under 1.2 times the size.
3. Find exclusions. Look for `node_modules`, build output, caches, virtual environments and temp files. Propose skipping them if they can be rebuilt, and list the rule. Keep anything the user cannot recreate.
4. Pick the format. A plain copy keeps files browsable and is easy to compare. A zip or tar archive is smaller and one file. Choose by the use: restore speed or storage. Avoid proprietary formats.
5. Name it `<folder>_YYYY-MM-DD` with the date of the backup. If the name exists, add a time, never overwrite an earlier backup.
6. Create it with `run_command` (for example zip, tar or a robust copy tool) while no program is writing to the folder. Ask the user to close editors and databases that keep files open.
7. Write a manifest with `run_command`: relative path, size, modified date and SHA-256 for each file. Save it inside the archive and beside it.
8. Verify. Count and size of the backup match the source minus exclusions. List the archive and compare to the manifest. Restore two files, one small and one large, into a temp folder and compare their hashes.
9. Set expectations on retention and repeats.
   - Ask how many dated copies to keep, and list which older ones can go once the new one is verified.
   - For a recurring backup, suggest the cadence the user can sustain, such as weekly, and an incremental option.
   - Do not delete older backups yourself without a stated rule from the user.
   - Mention a second location for anything that matters, since one copy on one drive is thin.
10. Write the restore note in plain steps, with the manifest and archive path.

## Gotchas

- Files held open or locked (databases, mail stores, VM disks) copy as corrupt or get skipped. Check the tool's skipped-file output and the exit code alone is too little.
- Long paths and special characters fail on some archivers. Look for errors and warnings, and read the tail of the log.
- Symlinks may be followed and duplicate data, or stored as links and break. State what the tool did.
- A backup never restored is a hope. The test restore in step 8 is not optional.
- Secrets inside the folder (keys, `.env` files) now exist in a second place. Mention it, and ask whether the destination is private.
- Permissions and timestamps may not survive a plain copy to another file system. If they matter, use a format that stores them.

## Output

- The retention suggestion in one line.
- Archive path, size, file count and manifest path.
- The exclusion rules applied and the files skipped with reasons.
- The result of the test restore, and a one-line restore instruction.
