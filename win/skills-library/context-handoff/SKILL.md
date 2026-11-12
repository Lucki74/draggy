---
name: context-handoff
description: Writes a compact handoff note with the goal, current state, decisions and their reasons, open problems and the exact next step, so a fresh session or another agent can continue without rereading the conversation. Use when the user asks for a handoff, to continue later, or to prepare context for another agent.
---

# Context handoff

## Goal

Capture what a newcomer needs to carry on the work in the next ten minutes. The note holds conclusions, not the history: what was asked, what is done, what was decided and why, what is broken and what to do first.

## When to use

- The user is stopping and wants to resume in a new session.
- Work moves to another agent, tool or person.
- A conversation has grown long and a clean restart would help.
- For a recap meant to be read as a report, use `use_skill` with `session-summary`.

## Steps

1. Ask with `ask_user` who or what reads the note (you in a new session, another agent, a teammate) and where it should be saved. Default to a file in the scratch area outside the project, so it is not committed by accident.
2. Check the real state, not memory. Run `git_status` and `git_diff` for changed files, and read the plan with `update_plan` if one exists. List what is changed, what is staged and what is untracked.
3. Write the goal in two sentences: what the user wants and why, in their words where possible.
4. Write the state: what is finished and verified, what is finished but unverified, what is in progress and what has not started. Name files with paths and give command lines that were run, with results in a few words.
5. Write the decisions with reasons. A decision without its reason gets reversed by the next reader. Include options that were rejected and why.
6. Write the open problems: errors seen (the exact message), suspects, things tried that did not work. This keeps the reader from repeating dead ends.
7. Write constraints and preferences the user stated: style rules, things not to touch, commands to run before finishing, anything that needs approval.
8. End with the next step, concrete enough to start without thinking: "run X, expect Y, then edit Z".
9. Save with `create_file`, re-read it once with `read_file`, and cut anything that does not help the reader act. Tell the user the path.

## Gotchas

- A transcript dump is not a handoff. Summarise, with pointers to files.
- Never write secrets, tokens or passwords into the note. Name where they live instead.
- State that has not been checked ("tests pass") must be marked as unchecked or rerun.
- Paths and branch names go stale. Include the branch and the commit if there is one.
- A vague next step ("continue the work") wastes the handoff. Name the file and the command.
- Notes saved inside the repository can end up committed. Say where it is saved.

## Output

- The note path and its length in lines.
- The goal, state, decisions, problems and next step headings, filled in.
- Anything you could not verify when writing it.
- A reminder to delete the note once the work is done.
