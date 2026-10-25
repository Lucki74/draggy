---
name: agent-instructions-writer
description: Writes instructions for a tool-using agent, such as a project agents file, covering the goal, commands, tools and when to use them, when to ask, stop conditions, safety limits and the reporting format, based on the actual repository. Use when the user asks to write agent instructions, create an agents file or tell a coding agent how to work in a project.
---

# Agent instructions writer

## Goal

Give an agent the few facts and rules it cannot learn by looking around: how to build and test, what not to touch, how to report, and when to stop and ask. The file is short, true to the repository, and checked by running the commands it lists.

## When to use

- A project has no instruction file for agents, or the file is long and stale.
- An agent keeps making the same mistake in a repository.
- For a chat assistant's standing prompt, use `use_skill` with `system-prompt-designer`.
- For the tools an agent will call, use `use_skill` with `mcp-builder`.

## Steps

1. Look before writing. Use `list_directory`, `search_files` and `read_file` on the readme, build files, test config, CI files and any existing instruction files. Note the real commands for install, build, test, lint and run.
2. Ask with `ask_user` for what the files cannot show: rules of the team, areas that must not change, review and commit conventions, which actions need approval, and recurring mistakes to prevent.
3. Write the commands first, in a short list, copied from the project and run with `run_command` to confirm they work. Add flags for quiet output and for running a single test.
4. Write the invariants: the few rules that tests or reviewers enforce and that are easy to miss, with the reason. For example, a generated file that must not be edited by hand, or a naming scheme.
5. State the boundaries. List the folders or files the agent should not change, the actions that need the user's approval (deleting, pushing, installing, network calls) and the secrets it must never print or commit.
6. Say when to ask and when to proceed. Give a rule such as: proceed on reversible choices and state the assumption; ask before anything destructive or when requirements conflict.
7. Define done. For example: build passes, relevant tests pass, only intended files changed, and a short report of what was run.
8. Define the report format: what changed, how it was checked, what is left, with file paths.
9. Cut. Remove anything the agent can see by reading the code, general advice that applies everywhere, and duplicates. Aim for a page or less, and link to longer docs for detail.
10. Save with `create_file` or `edit_file`, and re-run the listed commands once more from a clean state.

## Gotchas

- Commands that no longer work do harm. Run each before you list it.
- Rules without reasons get stretched or ignored. Add a clause of why.
- A long file is skimmed. Put the most violated rules first.
- Instructions drift when the code changes. Add a note about who updates them and when.
- Do not paste secrets, keys or internal URLs into the file.
- Avoid claims about what a particular model can do. Write instructions that hold for any capable agent.

## Output

- The instruction file path and its length.
- Commands confirmed by running them, and any that failed.
- Rules added with their reasons.
- Open questions for the team.
