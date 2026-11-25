---
name: bisect-regression
description: Finds the first commit that introduced a bug by running git bisect with a scripted pass or fail check, then reads that commit to explain the cause. Use when the user says something used to work, asks which commit broke it, or wants a regression bisected.
---

# Bisect a regression

## Goal

Name the single commit where behaviour went from good to bad and explain why that change caused it. A good result gives the commit, the evidence, and leaves the repository exactly as it was found.

## When to use

- A feature worked at a known earlier point and fails now.
- The history is long enough that reading every change is slow.
- The failure can be checked by a command, even a crude one.
- A release candidate fails a check that the previous release passed.
- The user has a command that shows the bug but no idea of the cause.
- A performance number got worse and the commit is unknown.

When there is no known good point or history, use `use_skill` with `systematic-debugging` instead.

## Steps

1. **Check the tree.** Run `git_status`. If there are uncommitted changes, stop and ask with `ask_user` whether to stash them. Note the current branch so you can return.
2. **Pick the endpoints.** Bad: the current commit or a named one. Good: the latest commit where it worked. Ask the user for a tag, date or version, then find the commit with `run_command` and git log. Verify the good commit really passes before starting.
3. **Write the check.** Create a small script with `create_file` outside the repository (the scratch directory) that exits 0 for good, 1 for bad, and 125 for "cannot test this commit" such as a build failure. It must fail for the same reason as the bug, so check the exact symptom.
4. **Run it by hand on both ends.** Confirm good gives 0 and bad gives 1.
5. **Bisect.** With `run_command`: start bisect, mark bad and good, then run it with the script. Install or rebuild inside the script when the dependencies changed between commits.
6. **Read the result.** Show the first bad commit with its message and `git show --stat`. Read the diff with `read_file` or `git_diff` and name the line or change that causes the failure.
7. **Reset.** Always finish with the bisect reset command, then run `git_status` to confirm the branch and tree match step 1.
8. If the bisect finishes on a merge or a commit with several changes, repeat the search inside it by hand.

## Gotchas

- A check that fails for another reason on old commits (missing file, old dependency) points to the wrong commit. Use exit code 125 for those.
- A cached build output or old node_modules makes a good commit look bad. Clean or rebuild inside the script.
- Merge commits and squashed history can make the first bad commit large. Read it, then narrow inside it by hand.
- A flaky check breaks the search. Run it several times per commit or fix it first.
- Leaving bisect active leaves the repository on a detached commit.

## Output

First bad commit hash, author date and subject, the check used, the likely cause in one or two sentences, and a note that bisect was reset. Suggest a fix only if it is clear.

Include the exact check script text in the answer so the user can rerun it.
