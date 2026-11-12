---
name: session-summary
description: Summarises what a work session changed, what was verified, what failed and what remains, checking the working tree and conversation so every claim is backed by something observed. Use when the user asks for a recap, what was done today, or a summary of the session.
---

# Session summary

## Goal

Give a short, honest account of the session. Each claim of "done" is backed by a check that was run, failures are shown and not tucked away, and the reader knows what to do next.

## When to use

- The user asks what was done, wants a recap or a status line.
- Work is ending and a summary goes to a teammate, a ticket or a changelog.
- For a note aimed at restarting work in a new session, use `use_skill` with `context-handoff`.
- For checking the work itself before calling it done, use `use_skill` with `verify-before-done`.

## Steps

1. Ask with `ask_user` who the summary is for and how long it should be, if unclear. A teammate wants outcomes; a ticket wants changes and risks.
2. Gather evidence. Run `git_status` and `git_diff` to see what actually changed, and read the plan from `update_plan` if one was kept. The tree is the truth where memory and tree disagree.
3. Group the changes by purpose, not by file. "Fixed the date parsing for week boundaries" is better than a list of three files. Give file paths for the main ones.
4. For each change, state its status: verified (with the command or check that proved it), changed but not verified, or attempted and abandoned.
5. List failures and surprises: tests that fail, errors that remain, assumptions that proved wrong. Include the exact error text for open ones.
6. List decisions that the reader may want to review, with the reason in a clause each.
7. List what was left out on purpose and what remains, in the order to do it.
8. Write it short. A first line with the outcome, then sections as needed. Trim any line that only narrates activity ("I looked at...").
9. If the summary goes into a file, save it with `create_file` and give the path. If it goes in chat, keep it under about fifteen lines.

## Gotchas

- "Should work" and "done" are different statuses. Only write "verified" for something you ran.
- A list of every command run is a log, not a summary.
- Leaving out the failed attempt makes the next person repeat it. One line is enough.
- Changes made by the user or another process may be in the tree. Attribute carefully, or say the origin is unknown.
- Numbers (tests passed, lines changed) should come from output you saw, not from estimates.
- Do not oversell. If half the task is done, say half.

## Output

- A one-line outcome.
- Changes grouped by purpose, with status.
- Failures, open risks and decisions to review.
- Remaining work in order, and the saved path if a file was written.
