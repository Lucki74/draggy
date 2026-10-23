---
name: merge-conflict-resolution
description: Resolves merge, rebase, cherry-pick and stash conflicts by reading both sides of each hunk, keeping the intent of both changes, and proving the result builds and passes tests. Use when the user asks to fix merge conflicts, gets CONFLICT output from git, or is stuck in the middle of a rebase.
---

# Merge conflict resolution

## Goal

Finish the merge or rebase with every conflict resolved by intent, not by picking a side. A good result has no conflict markers left, keeps what both branches meant to do, builds, and passes the tests that touch the conflicted files.

## When to use

- `git merge`, `git rebase`, `git cherry-pick` or `git stash pop` stopped with CONFLICT.
- The user sees `<<<<<<<` markers in files and wants them sorted.
- The user is mid-rebase and unsure what state the repo is in.
- To tidy history first so there are fewer conflicts, use `use_skill` with `interactive-rebase-cleanup`.

## Steps

1. Find out which operation is running. Call `git_status`: it names the operation (merge, rebase, cherry-pick) and lists the unmerged paths. Run `git log --oneline -n 5 --all --graph` with `run_command` to see both tips.
2. List every file with markers: `search_files` for `^<<<<<<< ` across the repo. Do not trust the status list alone, because a file can be marked resolved while markers remain.
3. For each conflicted file, work out what each side wanted. Run `git log -n 3 --format=%s -- <path>` on both tips, and `git diff --merge <path>` to see the combined diff. Read the file with `read_file`.
4. Resolve the hunk by intent. Three cases come up most: both sides edit different lines of the same block (keep both), both change the same line to different values (decide which value is right and ask the user if the code cannot say), one side deletes what the other edits (find out whether the deletion was a move or a removal).
5. Edit with `edit_file`, removing all three marker lines. For lock files and generated files do not hand-merge: take either side, then regenerate with the project's install or build command through `run_command`.
6. Check nothing was missed: `search_files` for `^(<<<<<<<|=======|>>>>>>>)` again, then `git diff --check` with `run_command`.
7. Build and test. Run the project's compile and the tests nearest the changed files. Resolved text that merges cleanly can still be wrong, such as two functions that now call each other twice.
8. Stage the files and continue: `git add <paths>`, then `git merge --continue`, `git rebase --continue` or `git cherry-pick --continue`. Use `GIT_EDITOR=true` in front of the continue command so no editor blocks the shell.
9. In a rebase, expect to resolve again on the next commit. Repeat from step 1 each time.

## Gotchas

- During a rebase "ours" is the branch you are rebasing onto and "theirs" is your own commit being replayed. In a merge it is the reverse. Reading the sides wrong silently drops your work.
- Taking one side with `--ours` or `--theirs` for a whole file is a decision to throw the other change away. Do it only when you checked that nothing on the discarded side matters.
- Whitespace and line-ending noise creates conflicts that are not real. A CRLF file merged with an LF edit may show every line changed; check the line endings before editing.
- A clean automatic merge can still break semantics: a renamed function on one side and a new call to the old name on the other. Only the build and tests catch this.
- If the resolution goes badly, `git merge --abort` or `git rebase --abort` returns to the starting state. Offer that before any destructive reset.
- Binary files (images, documents, databases) cannot be merged by hand. Pick a side, or ask the owner of the newer version which to keep.
- `git rerere` can remember resolutions and replay them. It helps with repeated rebases, and it can also replay a wrong resolution, so review what it applied.
- Do not push a half-finished rebase. Confirm `git_status` reports a clean tree first.

## Output

- A list of the files resolved, one line each, saying what was kept from each side and why.
- Any hunk where you made a judgment call, shown so the user can overrule it.
- The build and test commands run and their result.
- The state at the end: operation finished, branch name, and whether a push is now needed.
- Files taken whole from one side, listed separately, since those are the riskiest choices.
- Regenerated files (lock files, generated code) named with the command that rebuilt them.
- A reminder of the abort command if the user wants to back out before pushing.
