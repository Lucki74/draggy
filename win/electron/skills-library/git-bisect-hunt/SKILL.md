---
name: git-bisect-hunt
description: Finds the first bad commit behind a regression by running git bisect with a repeatable pass or fail check, then reads that commit and explains the cause. Use when the user asks when a bug started, which commit broke the build or a test, or to use git bisect.
---

# Git bisect hunt

## Goal

Name the single commit that introduced a regression, with proof. A good result gives the commit hash, its author line and subject, the test or script that flips from pass to fail at that commit, and a short reading of why that change causes the failure.

## When to use

- Something worked in an older version and fails now, and nobody knows which change did it.
- A test started failing somewhere in the last few dozen or few hundred commits.
- The user says "use bisect" or "find the commit that broke X".
- If the cause is unknown and there is no known good version, use `use_skill` with `debugging` before this one.

## Steps

1. Check the tree with `git_status`. It must be clean, because bisect checks out old commits. If it is not, ask the user whether to stash.
2. Pin down the bad and good points. Bad is usually `HEAD`. For good, ask with `ask_user` for a tag, date or commit where it worked. Verify both ends yourself in step 4 instead of trusting memory.
3. Write the check as a script, so bisect can run unattended. Use `create_file` for a file in the scratchpad or temp folder, not in the repo. The script exits 0 for good, 125 to skip an untestable commit, and any code from 1 to 127 except 125 for bad. Codes above 127 abort the whole run. Keep it narrow: build what is needed, run one test or one command, and nothing more.
4. Prove the check works at both ends. Run `git checkout <good>` and the script, expect 0. Run `git checkout <bad>` and the script, expect non-zero. If either end disagrees, fix the script before bisecting.
5. Run the search: `git bisect start <bad> <good>` then `git bisect run <script>` through `run_command`, with a generous timeout. Bisect needs about log2 of the number of commits in steps, so a thousand commits takes about ten runs.
6. Read the result. Bisect prints "<hash> is the first bad commit". Run `git show --stat <hash>` and `git show <hash>` and read the diff with `read_file` where the patch is long.
7. Confirm by hand: check out the parent and the culprit, run the script on each, expect pass then fail.
8. Always finish with `git bisect reset` so the repo returns to the original branch. Then check `git_status` shows the starting branch and a clean tree.
9. Explain the mechanism as well as naming the hash. If the culprit is a merge commit, bisect with `--first-parent` or look at the branch it merged to find the real change.

## Gotchas

- A flaky check is the usual reason bisect names an innocent commit. Run the check several times at the first bad and last good points before trusting it.
- Some old commits do not build for unrelated reasons (a broken dependency, a half-done refactor). Return 125 for those so they are skipped, not counted as bad.
- Dependencies installed for HEAD may not match an old commit. If the check needs `npm install` or a lockfile restore, put that in the script, and expect it to slow every step.
- Do not leave the script inside the repo working tree. It can be wiped by the checkout, or flagged as an untracked file that blocks it.
- Skipped commits can make the answer a range of commits, not one. State that honestly if bisect reports several candidates.
- Bisect assumes one change flipped the result and it stayed flipped. If the bug came and went, or two commits both contribute, the answer is only one of them.
- A test that was added later does not exist in old commits. Copy the check somewhere stable, so each checkout does not remove it.
- Interrupting the run leaves the repo detached at some old commit. Always run `git bisect reset`.

## Output

- The first bad commit: hash, subject, author and date.
- The check used and how you proved it at both ends.
- Two or three sentences on why that change breaks behavior, citing the changed lines.
- Any commits skipped, and the confirmation that the repo is back on the original branch.
- A suggested fix or revert command, offered but not run.
- If bisect could not finish, the narrowest range it reached and what blocked it.
- Keep the report to a screen: hash, evidence, cause, next step.
