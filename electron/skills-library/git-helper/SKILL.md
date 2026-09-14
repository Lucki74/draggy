---
name: git-helper
description: "Helps with git beyond basic commits: resolving merge conflicts, rebasing, undoing mistakes, recovering lost work, cleaning history and understanding what happened, always with safe, explained commands. Use when the user has a git problem or asks how to do something in git."
---

# Git helper

Git mistakes can destroy work. Look before acting, prefer reversible commands, and explain each command before running it.

## Always first

1. `git status` (git_status) to know the branch, staged and unstaged changes, and whether a merge or rebase is in progress.
2. `git log --oneline --graph -15` with run_command to see history.
3. If there are uncommitted changes and the operation could touch them, suggest `git stash push -m "backup before ..."` or a temporary commit first.

## Common tasks

- **Merge conflict:** list conflicted files (`git diff --name-only --diff-filter=U`). For each, read_file, understand both sides (ours = current branch, theirs = incoming), resolve by editing with edit_file to keep the correct combination (not blindly one side), remove all conflict markers, then `git add <file>`. Run tests before `git merge --continue` or `git rebase --continue`.
- **Undo the last commit, keep changes:** `git reset --soft HEAD~1`.
- **Discard changes to one file:** `git restore <file>` (irreversible for those changes: confirm with the user).
- **Undo a pushed commit:** `git revert <sha>`, which is safe for shared branches.
- **Recover lost commits or a deleted branch:** `git reflog`, find the sha, then `git branch recovered <sha>`.
- **Wrong branch:** commit or stash, switch, then `git cherry-pick <sha>` or `git stash pop`.
- **Clean up local commits before pushing:** interactive rebase cannot run here because it needs an editor; use `git reset --soft <base>` and re-commit, or explain the interactive steps for the user to run in their terminal.
- **What changed and who:** `git log -p -- <file>`, `git blame -L <start>,<end> <file>`.

## Never without explicit confirmation

`git reset --hard`, `git clean -fd`, `git push --force` (suggest `--force-with-lease`), deleting branches, rewriting history that has been pushed, `git checkout -- .` on uncommitted work. State what will be lost before asking.

Commands run with run_command cannot answer prompts: pass flags like `--no-edit` for merges and set `GIT_EDITOR=true` where an editor would open.

## Report

What was wrong, what you ran and why, the resulting state (`git status` and `git log --oneline -5`), and how to undo it if needed.
