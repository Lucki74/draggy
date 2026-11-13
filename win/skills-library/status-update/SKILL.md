---
name: status-update
description: Turns rough notes, tickets or commit lists into a status update with the headline first, then done, next, blocked and asks, written for a reader with two minutes. Use when the user says "write a status update", "weekly update for my manager" or "summarize progress for stakeholders".
---

# Status update

## Goal

Tell the reader where a project stands, what changed, what is at risk and what is needed from them. A good update has an honest headline, outcomes instead of activity and a clear ask.

## When to use

- A weekly or monthly report to a manager, client or steering group.
- A project update after a milestone or an incident.
- A handover note before leave.

For a one-off company-wide message, use `use_skill` with `email-writer`. For a bug or incident chain, use the debugging skills first, then summarize here.

## Steps

1. **Collect the raw material.** Call `read_file` on notes, ticket exports or a changelog. If the project is a git repo, call `run_command` with `git log --oneline --since="7 days ago"` to see what shipped. Ask with `ask_user` for the reporting period and the reader.
2. **Find the headline.** One sentence: on track, at risk or late, and why. Decide this before writing anything else. If the status is amber or red, the first line says so.
3. **Turn activity into outcomes.** "Worked on login" becomes "Login now supports SSO; two edge cases open". If an item has no outcome, drop it or move it to Next.
4. **Write Done.** Three to five bullets, each an outcome with a number or a link when one exists.
5. **Write Next.** The items for the coming period with an owner and a date where known.
6. **Write Blocked or At risk.** Each item: what, since when, impact, and what would unblock it. Do not leave this section out to look good. Write "None" only if true.
7. **Write Asks.** Decisions or help needed, with who and by when. If there are none, say so.
8. **Compare with the last update.** Ask for the previous one. Items promised then and missing now must appear, either as done or as slipped, with the new date.
9. **Cut to fit.** Aim for under 200 words for an email. Move detail to a link.
10. **Match the reader.** A manager wants risks and asks. A client wants dates and deliverables. An executive wants one paragraph. Ask which reader and trim to fit.
11. **Check every claim.** Each "done" item should point to something the reader can open, such as a merged change, a document or a release. Mark anything unverified as such.

## Gotchas

- A slipped date buried at the bottom is the failure readers remember. Put it in the headline.
- Green status with an open risk in the body is contradictory. Match the label to the worst item.
- Do not list every meeting attended. Meetings are inputs, not results.
- Percentages like "80 percent done" mislead because the last 20 percent is often half the work. Prefer concrete remaining tasks.
- Never invent metrics, dates or names. If a number is unknown, write a gap marker and ask.
- Names in a blocked list can read as blame. Describe the dependency by role or task.
- Copying last week's update and editing it carries over stale items. Start from the notes, then compare.
- Jargon from the team's tools (ticket codes, branch names) means nothing to outside readers. Use plain names.
- A long Done list can hide a missed goal. Put the main goal of the period first and say whether it was met.

## Output

The update in the user's medium: email with subject, or a chat post. Order: headline, Done, Next, Blocked or At risk, Asks. Plain bullets, no bold labels beyond the section names. One closing line if the user must confirm any assumed date.

If the user sends updates on a schedule, offer a reusable skeleton with the five headings and no content.
