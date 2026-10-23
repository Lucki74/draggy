---
name: document-organizer
description: Designs a simple folder and naming system for household papers, digital or physical, with a short list of what to keep, where and for how long, checked against official sources. Use when the user asks to organize documents, how to file papers, or set up a folder system for records.
---

# Document organizer

## Goal

Give the user a filing system they can keep up: few folders, clear names, a backup, and a simple rule for what to keep and what to discard.

## When to use

- Papers and scans are scattered across a desk, email and a downloads folder.
- The user wants to find a document in under a minute.
- Preparing papers for one visit is `use_skill` with `appointment-prep`.

## Steps

1. Ask with `ask_user` whether the system is digital, paper or both, how many documents there are, and who shares access.
2. If the user points to a folder, scan it with `list_directory` and note file types, names and obvious duplicates.
3. Propose top-level categories of about eight or fewer, such as identity, home, money, insurance, work, health admin, vehicles and manuals.
4. Choose a naming pattern with the date first in year-month-day order, then the source and the topic, for example 2025-03-14 insurer policy renewal.
5. Show the user the structure and a few renames before changing anything. Ask for confirmation.
6. After approval, move and rename files with `move_file` in small batches, and report each batch.
7. Flag duplicates and ask before deleting any. Do not delete anything on the user's behalf.
8. Build the keep list. Ask the user to confirm retention periods for tax, property and insurance papers with the official body or a professional, since rules differ by country and change.
9. Mark papers to keep in original form, such as birth certificates and deeds, and store scans in addition.
10. Set up a backup: one copy elsewhere, and encryption for identity papers. Note who can reach it in an emergency.
11. Write a short readme with the structure, naming pattern and yearly review date, and save it with `create_file`.
12. Set a monthly five-minute routine: scan or file new papers, empty the inbox folder.

## Gotchas

- Too many nested folders.
- Stating retention periods from memory.
- Storing scans without a backup.
- Renaming files that another program links to by path.
- Deleting duplicates before checking which is the latest version.
- Keeping passwords in a plain file next to the documents.
- Mixing personal and work documents in one folder.
- Using names only the user understands today.

## Output

A folder structure, a naming rule with examples, a keep and discard list marked as needing official confirmation, and a short readme.
