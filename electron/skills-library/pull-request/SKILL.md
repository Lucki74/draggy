---
name: pull-request
description: Writes pull request descriptions from the branch's real diff and commits (summary, why, changes, testing, risks, screenshots to add) and can open the PR with the GitHub CLI. Use when the user asks for a PR description or to open a pull request.
---

# Pull request

## Gather

1. Find the base branch: `git remote show origin` or check for main/master/develop with run_command.
2. `git log --oneline <base>..HEAD` for the commits, and `git diff <base>...HEAD --stat` then the full diff for the content. Read the diff.
3. Look for a PR template: `.github/pull_request_template.md` or `.github/PULL_REQUEST_TEMPLATE/`. If there is one, fill it in instead of the structure below.
4. Find linked issues from commit messages or the branch name.

## Write

- **Title:** what the PR does, in the project's convention (check recent PR titles with `gh pr list --state merged --limit 10` if gh is available).
- **Summary:** 2 to 4 sentences: the problem and the solution.
- **Changes:** bullet list of meaningful changes grouped by area, not a file list.
- **How to test:** exact steps or commands a reviewer can follow, and what they should see.
- **Risks and notes:** migrations, breaking changes, feature flags, performance, things reviewers should look at closely.
- **Screenshots:** a placeholder line if the change affects UI.
- **Links:** "Closes #123" for issues it resolves.

Keep it honest: do not claim tests were run unless they were.

## Opening it

Only if the user asks: make sure the branch is pushed (`git push -u origin HEAD`, after confirming), then run `gh pr create --title "..." --body-file <file>` with run_command, writing the body to a temporary file with write_file first and deleting it afterwards. Report the PR URL. If gh is not installed or not authenticated, give the description for the user to paste.
