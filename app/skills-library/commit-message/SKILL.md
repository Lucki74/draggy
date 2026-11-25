---
name: commit-message
description: Writes clear commit messages from the actual staged or unstaged diff, following the project's existing convention (Conventional Commits, one-line style or other), and can make the commit. Use when the user asks for a commit message or to commit their changes.
---

# Commit message

## Goal

A subject line, and a body only when the convention calls for one, that tells a future reader what changed and why, written in the project's own style and based on the real diff.

## When to use

- The user asks for a commit message.
- The user asks to commit their changes.
- For release notes across many commits, use `use_skill` with `changelog`.

## Steps

1. See what is being committed. Run `git_status` for the files and whether anything is staged. Run `git_diff` with staged set to see staged changes. If nothing is staged, run `git_diff` for unstaged changes and ask whether to stage everything or specific files. Read the diff itself; file names are not enough.
2. Match the project's convention. Run `git log --oneline -15` with `run_command` and follow it:
   - **Conventional Commits** (`feat(auth): ...`, `fix: ...`): use the same types and scopes.
   - **One-line descriptive sentences:** write one line in the same voice.
   - **Ticket prefixes** (`ABC-123: ...`): ask for the ticket number if needed.

   Also check AGENTS.md or CONTRIBUTING.md for commit rules, which override defaults.
3. Write the message:
   - **Subject:** imperative mood ("Add", "Fix", "Remove"), under about 72 characters, no trailing full stop, describing the effect rather than the mechanics ("Stop duplicate emails when a form is submitted twice" rather than "Change handler").
   - **Body**, only if the convention uses bodies and the change needs it: why the change was made, what it affects, anything surprising. Wrap at 72 characters.
   - Mention breaking changes where the convention has a marker (`BREAKING CHANGE:` or `!`).
4. If the diff contains unrelated changes, suggest splitting them into separate commits and propose a message for each.
5. Commit only when the user asked. Stage the agreed files and commit with `run_command`, for example `git add <files>` then `git commit -m "<subject>"` (add `-m "<body>"` for a body). Show the resulting `git log --oneline -1`.

## Gotchas

- Never use `--no-verify`, and never amend or push unless asked.
- If a pre-commit hook fails, report its output and fix the underlying problem rather than bypassing it.
- A message written from file names alone describes what was touched, not what changed. Read the diff.
- Subjects like "Change handler" say nothing. Name the effect.
- Staging everything with `git add -A` can sweep in unrelated or untracked files. Stage the agreed files by name.

## Output

The proposed message in a code block. When a commit was made, the resulting one-line `git log` entry.
