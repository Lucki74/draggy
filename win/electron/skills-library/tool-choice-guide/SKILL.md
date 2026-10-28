---
name: tool-choice-guide
description: Chooses the cheapest tool that can answer each question during agent work, such as search before read, read before run and static fetch before browser, and explains the choice when the user asks how a lookup should be done. Use when the user asks which tool or approach to use to find something out, or when a task needs a lookup strategy.
---

# Tool choice guide

## Goal

Answer each question with the lightest tool that can answer it. That saves time and context, avoids side effects and keeps the evidence checkable.

## When to use

- A task needs information and several tools could supply it.
- The agent has been reading whole files or opening browsers where a search would do.
- The user asks how the agent finds things or why it picked a tool.
- To plan a whole task, use `use_skill` with `task-decomposer`.

## Steps

1. State the question you need answered in one line: "where is X defined", "what does this page say", "does this command succeed".
2. Classify it. Is the answer in the workspace, on the web, in a running system, or only in the user's head?
3. For workspace questions, start with `search_files` to find the location by name or text. Then read only the part you need with `read_file` and a line range. Use `list_directory` to learn a folder's shape. Use `explore` when the search is broad and the answer is a conclusion, not a file.
4. For questions about changes, use `git_status` and `git_diff`, which are exact and cheap.
5. For web questions, use `search_web` to find candidates and `read_url` for pages that are static. Move to the `browser_*` tools only when the page needs scripts, clicks, a login the user handles, or a visual check.
6. For questions about behaviour, run it: `run_command` for programs and tests, `run_command` for a quick calculation or a small script. Prefer a read-only command first, and a dry run before a real one.
7. For answers only the user has (preferences, credentials, approvals), use `ask_user`. Batch the questions and propose defaults.
8. For edits, use `edit_file` for a targeted change, `write_file` or `create_file` for new content, and `move_file` and `delete_file` only with the user's consent for anything not clearly yours.
9. Check that the result answers the question. If not, step up to the next heavier tool and note why. Stop climbing once you have evidence.

## Gotchas

- Reading a large file to find one line costs far more than a search. Search first.
- Running a command to display a file is `read_file`'s job, and it avoids shell quoting problems.
- A browser for a static page is slower and noisier than `read_url`.
- Search results are leads, not proof. Open the source for any detail you will state.
- Tools with side effects need more care than tools that only read. Check what the command does before running it.
- Repeating the same failing tool with small changes is a signal to switch tools or ask.

## Output

- The question, the tool chosen and why, in one line each.
- The evidence found and where.
- Any step up to a heavier tool and the reason.
- Tools you skipped because of side effects, and why.
