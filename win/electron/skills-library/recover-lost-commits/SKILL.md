---
name: recover-lost-commits
description: Recovers lost commits, deleted branches, dropped stashes and work wiped by a hard reset or bad rebase, using the reflog and unreachable objects, and restores them onto a new branch. Use when the user says they lost work, deleted a branch by accident, ran git reset --hard, or dropped a stash.
---

# Recover lost commits

## Goal

Get the work back without making things worse. A good result identifies the exact lost commit, puts it on a new named branch, and proves the files match what the user remembers, while the current state stays untouched until the user decides.

## When to use

- A branch was deleted, force-pushed over, or reset to an older commit.
- A rebase, merge or `git reset --hard` removed commits from view.
- A stash was dropped or popped and then lost.
- The user wants to undo the last git command.
- For hunting a bad change rather than a lost one, use `use_skill` with `git-bisect-hunt`.

## Steps

1. Stop writing. Tell the user not to run `git gc`, `git clean` or `git prune`, and do not run them yourself. Call `git_status` to see the current state and note what is uncommitted.
2. Look at the reflog: `git reflog -n 50` with `run_command`. It lists every place HEAD pointed, newest first, with the action that moved it. For one branch use `git reflog show <branch>`.
3. Find the target. Match on the message, the time (`git reflog --date=iso`) or the action just before the damage, such as `reset: moving to` or `rebase (start)`. The state you want is usually the entry just before it.
4. Inspect the candidate without moving anything: `git show --stat <hash>` and `git log --oneline -n 10 <hash>` with `run_command`. Ask the user to confirm it is the right commit by subject or by a file they remember.
5. Restore onto a new branch, never onto the branch you are on: `git branch recovered/<name> <hash>`. Check `git log --oneline -n 5 recovered/<name>`.
6. For a dropped stash, the reflog does not hold it. Run `git fsck --no-reflogs --unreachable | grep commit` with `run_command` (or `git fsck --lost-found`) and look for commits whose message begins with `WIP on` or `On <branch>`. Show each with `git show --stat`. Restore with `git branch recovered/stash <hash>` or `git stash apply <hash>`.
7. For work that was never committed, git cannot help. Say so. Suggest the editor's local history or the operating system's file history, and `git fsck --lost-found` only if the files were once staged with `git add`, since staged blobs exist in the object store.
8. For a force-pushed remote branch, check teammates' clones and the host's own record, such as a pull request page or activity log, using `read_url` if given a link. The remote reflog is not available on most hosts.
9. Once the user confirms, merge or cherry-pick from the recovery branch into the working branch: `git cherry-pick <hash>` or `git merge recovered/<name>`. Leave the recovery branch in place until the user says delete it.

## Gotchas

- Reflog entries are local to this clone and expire, 90 days for reachable and 30 for unreachable entries by default. A fresh clone has none.
- `git reset --hard HEAD@{1}` is the quick undo and also overwrites uncommitted work in the tree. Branch first, then reset.
- The reflog tracks branch tips and HEAD, so a commit that was only ever reachable from a deleted branch shows up under HEAD only if you had it checked out. Otherwise fall back to `git fsck`.
- Unreachable objects found by fsck have no branch names or dates. Match them by diff content, not by guesswork.
- Amended commits keep both versions. The pre-amend commit is a separate entry in the reflog, not a modification.
- A deleted branch that was never merged has no reflog of its own after deletion. Search HEAD's reflog for the branch name in checkout lines to find its last tip.
- Recovering onto the current branch with a hard reset can discard the work done since the incident. Always recover to a new branch first.

## Output

- The commit recovered: hash, subject, date and the branch it now lives on.
- The commands used, so the user can repeat them.
- What could not be recovered, such as work that was never staged.
- The next step for the user, such as a merge or cherry-pick, left as their decision.
- A short note on how the loss happened, if clear, and the habit that prevents a repeat (branch before reset).
- The time limit: say how long the reflog entries are likely to survive on this machine.
- No claim of full recovery unless the file contents were compared to what the user remembers.
