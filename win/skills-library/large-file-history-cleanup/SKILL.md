---
name: large-file-history-cleanup
description: Finds oversized or sensitive files buried in git history, plans a rewrite with git filter-repo on a fresh mirror clone, and lists the follow-up steps for collaborators, forks and credentials. Use when the user says the repo is huge, wants a big file removed from all history, or committed a secret.
---

# Large file history cleanup

## Goal

Shrink the repository or remove a leaked file for good, with a plan the whole team can follow. A good result identifies the exact blobs, rewrites history on a disposable clone, verifies the outcome, and covers what rewriting cannot fix: other copies and exposed credentials.

## When to use

- Clones are slow and `.git` is far larger than the working tree.
- A binary, dump or video was committed once and is dead weight now.
- A password, token or key was committed.
- For stopping the file from coming back, follow with `use_skill` with `gitignore-audit`.
- For a mistake in the last few local commits only, `use_skill` with `recover-lost-commits` or `interactive-rebase-cleanup` is simpler.

## Steps

1. Measure first. Run `git count-objects -vH` with `run_command` for the size, then list the biggest blobs in history:
   `git rev-list --objects --all | git cat-file --batch-check="%(objecttype) %(objectname) %(objectsize) %(rest)" | sort -k3 -n -r | head -20`
   Note path, size and the commit that added each.
2. Decide the scope with the user through `ask_user`. Options: remove one path, a glob, everything over a size, or a secret string. Also ask whether the repo has forks, open pull requests, CI caches or protected branches, since each makes a rewrite harder.
3. If the file is a secret, tell the user to revoke and rotate it now, before any cleanup. History rewriting does not undo exposure.
4. Check that git filter-repo is installed (`git filter-repo --version`). If not, look up its current install instructions with `search_web` or `read_url` rather than guessing. It replaces the old filter-branch, which is slow and error prone.
5. Work on a fresh mirror clone, never the working repo: `git clone --mirror <url> cleanup.git`. Take a separate backup copy of the original.
6. Run the rewrite inside the clone. Examples: `git filter-repo --path path/to/big.bin --invert-paths` to drop a path, `--strip-blobs-bigger-than 10M` for a size cutoff, or `--replace-text rules.txt` for strings. Write rules.txt with `create_file`.
7. Verify: compare `git count-objects -vH` before and after, confirm the removed path with `git log --all -- <path>` returns nothing, and check that the latest tree still builds if the file was only a leftover. If the file is still needed at HEAD, restore it as a normal ignored or LFS-managed file.
8. Plan the push. filter-repo changes every commit hash after the first touched one. Pushing needs `git push --force --mirror` to a repo the user controls, plus unprotected branches for the moment. Do not push without explicit agreement.
9. Write the team notice with `create_file`: everyone must re-clone, not merge or pull the old history, and any local branches need rebasing onto the new commits.
10. Ask the host to purge cached objects (pull request refs and dangling commits stay reachable on some hosts until support clears them). Look up the host's current procedure with `read_url`.

## Gotchas

- A leaked secret stays compromised even after a perfect rewrite. Forks, clones, CI logs and the host's cached views may keep it. Rotation is the fix, the cleanup is hygiene.
- Rewritten history changes tag targets and signatures. Signed commits and tags lose their signatures, and old release tags need to be recreated.
- Pull requests and issues link to old hashes, which then stop resolving. Note this for the team before they hit it.
- Running filter-repo in the original working clone discards its remote setup by design, as a safety measure. Use a fresh clone, then add the remote back deliberately.
- Large files that are still needed belong in Git LFS or an artifact store, not back in the repo. Moving to LFS also needs the history rewrite, via the migrate command, or the old blobs stay.
- Shallow clones and sparse checkouts miss old blobs. Measure with a full clone.

## Output

- The table of top blobs found, with path, size and first commit.
- The agreed scope and the exact command run.
- Before and after sizes, and the verification result.
- The team notice, the rotation checklist for any secret, and what is still pending on the host.
- The location of the backup of the original repository.
- The long-term fix for the cause: an ignore rule, a pre-commit size check, or LFS.
- A clear statement that nothing was pushed unless the user said so.
