---
name: filename-convention
description: Designs a short, sortable filename convention for a person or team, with examples and a check of existing files against it. Use when the user asks for a naming convention for files, how to name documents, or to standardise file names.
---

# Filename convention

## Goal

Agree a rule people will follow, that sorts correctly, tells you what a file is without opening it, and survives all operating systems. A good convention fits on one card, has four or fewer fields and comes with real examples from the user's own files.

## When to use

- A team shares files and cannot find the latest version.
- A person wants a rule for scans, photos, invoices or project documents.
- For applying a rule to many existing files, use `use_skill` with `batch-rename`.
- For sorting files into folders, use `use_skill` with `file-organizer`.

## Steps

1. Learn the context with `ask_user`: who creates the files, who looks for them, what types (reports, invoices, photos), whether a folder tree already exists, and what goes wrong today.
2. Sample existing names. Use `list_directory` and look at 30 names. Note the patterns people already use, which is the best base for a rule that will stick.
3. Choose the fields from what people search by. Candidates are date, project or client, document type, short description, version. Keep at most four, and drop any that the folder path already holds.
4. Fix the formats. Put dates first as `YYYY-MM-DD` so alphabetical order is time order. Pick one separator between fields (underscore) and one inside fields (hyphen). Choose a case. Avoid spaces, accents and the characters `\ / : * ? " < > |`.
5. Decide versioning. Use `v01`, `v02` for drafts, and one word for the end state, or rely on the system's history if the files live in a cloud drive that keeps versions. Ban `final`, `final2` and `latest`.
6. Set limits: names under about 60 characters, and a short list of allowed document type words, such as `invoice`, `minutes`, `report`.
7. Write the rule card with `create_file`: pattern, field list, three good examples built from the user's real files, and three bad ones with the fix.
8. Test the rule on the 30 sampled names with `run_command`. Report how many already fit and how many need changes, and what the common breaks are. Adjust the rule if most files break the same part.
9. Plan the rollout so the rule is used.
   - Put the card where people already work, such as the root of the shared drive.
   - Start applying it to new files only, and rename old files in a separate, agreed pass.
   - Name one person who answers questions about edge cases.
   - Review after a month: sample 30 new names and count how many follow the rule.
10. Offer to prepare a rename of old files using the batch-rename skill, with a preview.

## Gotchas

- A rule with eight fields is dead on arrival. People will skip fields, and then names are neither sortable nor consistent.
- Dates written `03-04-2025` are ambiguous between regions and sort wrongly. Year-first is the only safe order.
- Client or project names change. If the field will be renamed often, use a short code and keep the code list in one place.
- Path length limits apply to the whole path. Long folder names plus long file names exceed them on Windows.
- A convention without an owner drifts. Name who maintains the card and where it lives.
- Rules that clash with a tool's own naming (a scanner that stamps its names, a camera) will be broken daily. Rename at the first step of handling, not at creation.

## Output

- The rollout plan in three lines.
- The rule card: pattern, fields, formats, versioning and allowed words.
- Six examples, three good and three corrected.
- The result of the test on existing names, and the suggested next step.
