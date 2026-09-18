---
name: commit-message
description: Writes clear commit messages from the actual staged or unstaged diff, following the project's existing convention (Conventional Commits, one-line style or other), and can make the commit. Use when the user asks for a commit message or to commit their changes.
---

# Commit message

## 1. See what is being committed

- git_status for the files and whether anything is staged.
- git_diff with staged set to see staged changes; if nothing is staged, git_diff for unstaged changes and ask whether to stage everything or specific files.
- Read the diff, not just the file names. Understand what changed and why.

## 2. Match the project's convention

Run `git log --oneline -15` with run_command and follow what is there:
- **Conventional Commits** (`feat(auth): ...`, `fix: ...`): use the same types and scopes the project uses.
- **One-line descriptive sentences:** write one line in the same voice.
- **Ticket prefixes** (`ABC-123: ...`): ask for the ticket number if needed.
Also check AGENTS.md or CONTRIBUTING.md for commit rules; they override defaults.

## 3. Write it

- **Subject:** imperative mood ("Add", "Fix", "Remove"), under about 72 characters, no trailing full stop, describing the effect rather than the mechanics ("Stop duplicate emails when a form is submitted twice" rather than "Change handler").
- **Body** (only if the convention uses bodies and the change needs it): why the change was made, what it affects, anything surprising. Wrap at 72 characters.
- If the diff contains unrelated changes, suggest splitting into separate commits and propose a message for each.
- Mention breaking changes explicitly where the convention has a marker (`BREAKING CHANGE:` or `!`).

## 4. Commit, if asked

Only when the user asked to commit: stage the agreed files and commit with run_command, for example `git add <files>` then `git commit -m "<subject>"` (add `-m "<body>"` for a body). Never use `--no-verify`, never amend or push unless asked. Show the resulting `git log --oneline -1`.

If a pre-commit hook fails, report its output and fix the underlying problem rather than bypassing it.
