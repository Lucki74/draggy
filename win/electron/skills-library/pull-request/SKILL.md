---
name: pull-request
description: Writes pull request descriptions from the branch's real diff and commits (summary, changes, testing, risks, screenshots to add) and can open the PR with the GitHub CLI. Use when the user asks for a PR description, a PR title, or to open or create a pull request.
---

# Pull request

## Goal

A description a reviewer can act on without asking questions: what the PR does and why, how to test it, and where to look closely. Every claim in it comes from the actual diff and commits.

## When to use

- The user asks for a PR description or title.
- The user asks to open or create a pull request.
- For a single commit message, use `use_skill` with `commit-message`.
- For reviewing the changes first, use `use_skill` with `code-review`.

## Steps

1. Find the base branch with `run_command` (`git remote show origin`, or check for main, master or develop).
2. Run `git log --oneline <base>..HEAD` for the commits, then `git diff <base>...HEAD --stat` and the full diff with `run_command`. Read the diff.
3. Look for a PR template with `search_files`: `.github/pull_request_template.md` or `.github/PULL_REQUEST_TEMPLATE/`. If one exists, fill it in instead of the structure below.
4. Find linked issues in the commit messages or the branch name.
5. Write the description:
   - Title: what the PR does, in the project's convention. Check recent titles with `gh pr list --state merged --limit 10` if gh is available.
   - Summary: 2 to 4 sentences covering the problem and the solution.
   - Changes: bullets of meaningful changes grouped by area, not a file list.
   - How to test: exact steps or commands a reviewer can follow, and what they should see.
   - Risks and notes: migrations, breaking changes, feature flags, performance, anything reviewers should check closely.
   - Screenshots: a placeholder line if the change affects UI.
   - Links: "Closes #123" for issues it resolves.
6. Open the PR only if the user asks:
   - Confirm with the user, then make sure the branch is pushed (`git push -u origin HEAD`).
   - Write the body to a temporary file with `write_file`.
   - Run `gh pr create --title "..." --body-file <file>` with `run_command`, then remove the temporary file.
   - If gh is missing or not authenticated, give the description for the user to paste.

## Gotchas

- Do not claim tests were run unless you ran them or saw the result.
- Describe the whole branch, from the first commit to the last.
- A file-by-file list tells the reviewer nothing the diff does not. Group by purpose.
- Check the project's PR title convention before inventing one.
- Pushing is visible to others, so ask first.

## Output

The title and the description in Markdown, ready to paste. If you opened the PR, add its URL.
