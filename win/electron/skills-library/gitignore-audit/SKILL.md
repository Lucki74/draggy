---
name: gitignore-audit
description: Audits a repository's ignore rules, finds build output, dependencies, secrets and editor files that are tracked or at risk of being committed, and fixes .gitignore without deleting anyone's local files. Use when the user says .gitignore is not working, asks what to ignore, or wants a tracked file removed from git but kept on disk.
---

# Gitignore audit

## Goal

Make the ignore rules match what the project really produces, and get wrongly tracked files out of the index safely. A good result adds the missing rules, explains why a rule had no effect, untracks files with `git rm --cached`, and flags anything sensitive that needs more than an ignore line.

## When to use

- A file is listed in .gitignore but still shows up in `git status`.
- A new project needs a sensible ignore file.
- The user wants `.env`, `node_modules`, build folders or editor settings kept out of the repo.
- The repo has grown and someone suspects generated files are tracked.
- For huge or secret files already in history, use `use_skill` with `large-file-history-cleanup`.

## Steps

1. Read the current rules: `read_file` on every `.gitignore` found by `search_files` with pattern `.gitignore` plus `.git/info/exclude`. Also run `git config core.excludesFile` with `run_command`, since a global file can hide or add rules.
2. Detect the stack with `list_directory` on the root: look for package.json, Cargo.toml, pyproject.toml, a Gradle or .NET project and so on. List what each toolchain writes: dependency folders, build output, caches, coverage reports.
3. See what is tracked that should not be: `git ls-files -ci --exclude-standard` lists tracked files that match an ignore rule. Then scan for likely offenders by name: `git ls-files | grep -E "\.env|\.pem|\.key|dist/|build/|node_modules|\.log$|\.DS_Store"`.
4. See what is untracked but unignored: `git status --short --ignored` and read through the `??` entries.
5. Explain any rule that fails. Use `git check-ignore -v <path>` to print which rule matched, or the fact that none did. This settles most "it is not working" cases in one call.
6. Edit with `edit_file`. Anchor directory rules with a leading slash when they should apply only at the root (`/dist/`) and keep a trailing slash for directories. Keep project-specific rules in .gitignore, and personal editor or operating system noise in the user's global ignore file, with a note on how to set it.
7. Untrack, keeping the file on disk: `git rm --cached <path>` or `git rm -r --cached <dir>`. Show the list and get agreement before running it, then `git_status` to confirm the files show as deleted in the index but still exist.
8. Check each deletion line in the diff. Run `git_diff` with staged set, and make sure nothing needed (such as a lock file, `.env.example` or a committed config template) is being removed.
9. If a secret was ever tracked, say plainly that ignoring it now does not remove it from history and the credential must be rotated.

## Gotchas

- Ignore rules apply only to untracked files. A file already in the index stays tracked until `git rm --cached` removes it, which is the cause of most "not working" reports.
- A negation such as `!keep.txt` cannot re-include a file whose parent directory is ignored. Ignore the contents with `dir/*` instead of `dir/`, then negate.
- A pattern without a slash matches at any depth, and one with a slash in the middle is anchored to the file's own folder. `build` and `/build` behave differently.
- Lock files, `.env.example`, and checked-in IDE shared settings are often wanted. Do not ignore them just because they look generated.
- Never ignore a file with `git update-index --assume-unchanged` as a substitute. It is a local hint, not a rule, and git may drop it silently.
- Removing a file from the index makes teammates' next pull delete it from their disks when they pull the commit. Warn them for files like local config.
- A rule that ends with trailing spaces matches nothing unless the spaces are escaped. Check for stray whitespace in a rule that looks right.
- CRLF checkouts may leave rules with trailing carriage returns that never match. Check line endings if a rule looks right but fails.

## Output

- The rules added or changed, shown as a short diff.
- The tracked files proposed for untracking, with the reason, before anything is removed.
- The answer to "why was this not ignored", based on the `check-ignore` output.
- A list of anything sensitive, with the advice to rotate it.
- A note for teammates if untracking will delete files from their disks on pull.
- Rules moved to the global ignore file, with the command that sets it up.
- Nothing deleted from disk. The only removals are from the index.
