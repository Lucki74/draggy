---
name: job-search-tracker
description: Sets up a simple tracker for applications, contacts and next steps, with the dates needed to follow up on time. Use when the user wants to track job applications, set up a job search spreadsheet, or keep track of where they applied.
---

# Job search tracker

## Goal

Give the user a small file that answers three questions at a glance: where have I applied, what is waiting on me, and when should I follow up. It must stay light enough that the user keeps it up.

## When to use

- The user has applied to more than a few roles and is losing track.
- The user wants a weekly view of the search.
- Writing the follow-up itself is `use_skill` with `follow-up-email`.

## Steps

1. Ask with `ask_user` for the format: CSV that opens in a spreadsheet, or a Markdown table. Ask for the number of active applications and the expected pace.
2. Check for an existing file with `list_directory` and `read_file`, and import its rows when the user has one.
3. Define the columns, kept to nine or fewer: company, role, link, date applied, source, status, contact, next step, next-step date. Add a notes column only if the user wants it.
4. Define the status list: saved, applied, screen, interview, offer, rejected, withdrawn. Use these words only, so filters work.
5. Create the file with `create_file` and add the user's current applications. Mark unknown dates as blank, not guessed.
6. Save the posting text for each role in a folder next to the tracker, named by company and date, since postings are taken down.
7. Add the rule for follow-ups: a follow-up date a set number of days after each step, chosen by the user. Show the formula or the filter to find rows that are due.
8. Build a weekly view: rows with a next-step date this week, sorted by date.
9. If the user has `run_code` available and wants counts, compute applications by status and by source, and show how many got a reply.
10. Agree on a weekly ten-minute review: update statuses, clear due items, and add new roles.
11. Explain how to archive closed rows to a second sheet, so the main list stays short.
12. Test the tracker with three sample rows and confirm that the due-items filter shows the right ones.

## Gotchas

- Adding columns that nobody fills in, until the tracker is dropped.
- No next-step date, so the file records the past and prompts nothing.
- Free-text statuses that cannot be filtered.
- Keeping the posting only as a link, which dies when the role closes.
- Storing contact details that the contact did not expect to be kept. Keep to names, roles and the channel.
- Judging the search by the reply rate of a handful of applications.
- Moving rows between files by hand, which loses data. Use one file and a status column.

## Output

The tracker file, the folder for saved postings, the filter for due items and a short note on the weekly routine.
