---
name: standup-update
description: Writes a short standup update from recent work, listing what finished, what is next and what is blocked, in lines a team can read in a minute. Use when the user asks for a standup, a daily update for the team, or help recalling what they did yesterday.
---

# Standup update

## Goal

A three-part update that a teammate can scan in under a minute and act on. It states outcomes, not activity, and it shows blockers plainly with who can clear them.

## When to use

- The user needs to post or say a daily or async standup.
- The user cannot remember what they did since the last one.
- For a longer report to a manager or client, use `use_skill` with `status-update`.
- For a weekly personal look-back, use `use_skill` with `weekly-review`.
- The user writes async updates in a chat channel and wants a consistent format.

## Steps

1. Find the period. Ask with `ask_user` when the last update was, unless the user said "yesterday". Use that as the start.
2. Collect evidence. If the user works in a repository, run `git_status` and `run_command` with `git log --since="yesterday" --author=<name> --oneline` to see commits. Read the output; do not guess from branch names. Also ask about meetings, reviews and conversations, since commits miss them.
3. Group the evidence into outcomes. Ten commits on one feature become one line ("Login form validation merged"). Use past tense and a result.
4. Pick what is next. Ask for the one to three things planned for today. They should be things the user can finish, not hopes.
5. Ask about blockers. A blocker is something waiting on someone or something else. Write what is needed, from whom, and since when. A slow task is not a blocker.
6. Match the team's format. If the user has a template or a previous update in a file, open it with `read_file` and follow its headings and tone.
7. Trim. Each section holds at most three lines. Remove names of files, tickets without context and internal jargon the listener may not know.
8. Read it as the teammate would: can they tell what changed and where they can help?

## Gotchas

- Listing activity ("worked on the API") tells nothing. Say what is different now.
- Hiding a blocker to look productive costs the team more later. Show it with a named person.
- Reporting only commits misses review work, design, support and meetings. Ask about them.
- A "next" list of eight items is a wish list. Three at most.
- Do not pad a quiet day. "Reviewed two PRs, researched X, no code shipped" is fine.
- Check ticket numbers and names against the source before posting. A wrong link is worse than none.
- The git log shows work on every branch, including experiments. Report only what the team should know about.
- Spoken standups run shorter than written ones. Cut to one sentence per section if the user will say it aloud.

- Quote numbers the same way each day. Switching between hours and days for the same task confuses readers.

## Output

Three headings: Done, Next, Blocked. Two or three bullets each, one line per bullet, plain text so it pastes into chat. If nothing is blocked, write "None". No greeting or sign-off.
