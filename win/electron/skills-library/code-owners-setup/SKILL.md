---
name: code-owners-setup
description: Writes a CODEOWNERS file from real commit history and folder structure so pull requests request review from the right people, then tests every pattern against sample paths. Use when the user asks to add a CODEOWNERS file, decide who reviews a folder, or require owner approval before merge.
---

# Code owners setup

## Goal

Route each change to the people who know that code, without creating a bottleneck. A good result is a CODEOWNERS file in the right location with patterns checked against real paths, owners who can actually approve, and a note on the host settings that turn it into a requirement.

## When to use

- The team wants automatic review requests per folder.
- Reviews land on the wrong people or on nobody.
- The user wants merge to need approval from a path's owner.
- For the wider rules around branches and approval, use `use_skill` with `branch-strategy`.

## Steps

1. Find out which host is in use: `git remote -v` with `run_command`. GitHub, GitLab and Bitbucket each read the file from a slightly different place and use slightly different syntax, so confirm details against the host's current docs with `read_url` before writing. Check whether a file already exists with `search_files` for `CODEOWNERS`.
2. Map the repository. Use `list_directory` on the root and the main source folders, and group paths by area: apps, shared libraries, infrastructure, docs, CI config.
3. Mine real ownership from history. For each area, run `git shortlog -sne --since="12 months ago" -- <path>` with `run_command`. Note who commits and who reviews most. Do not assign owners from guesswork or from names in a README that may be stale.
4. Ask with `ask_user` for the owner handles to use: user names or team names on the host, and who is the fallback owner for everything else. Never invent a handle.
5. Write the file with `create_file`. Put a default rule first (`* @org/maintainers`), then specific rules after it, because later matching lines win. Use team handles over individuals so reviews survive people leaving. Keep each line to one pattern and a short list of owners.
6. Cover the sensitive paths deliberately: the CI configuration, the deployment manifests, the security-related code, the lock files if reviewed, and the CODEOWNERS file itself.
7. Test patterns. Pick ten real paths from `git ls-files` and decide by hand which rule each one hits, using last match wins. Where the host offers a validation view or API, use it and say so. Report any path that matches no owner.
8. Place the file in the location the host reads (the repo root, `.github/` or `docs/` for GitHub) and make sure only one copy exists, because the host picks the first it finds in a fixed order.
9. Tell the user the settings still needed: a branch protection rule or ruleset requiring code owner review, and that owners need write access for their approval to count.

## Gotchas

- The last matching pattern wins, not the first. A broad rule left at the bottom of the file overrides every specific rule above it.
- Owners without write access to the repository are ignored without warning, and a typo in a handle makes a line silently useless.
- Patterns follow gitignore-like globbing but not entirely: `docs/` matches the folder anywhere, `/docs/` only at the root, and `*` does not cross directory boundaries.
- Requiring owner review on a wide pattern with one owner turns that person into a gate. Prefer a team of at least three, or a narrow pattern.
- A merge from a person who is also the sole owner may still need a second reviewer, depending on the host rule. Check the setting rather than assume.
- Draft pull requests may not request owners until marked ready on some hosts.
- Contributors who commit most are not always the right reviewers. Weigh review history and recent activity, and ask when the two disagree.
- Sections and optional-owner syntax exist only on some hosts. Do not use them without confirming support.

## Output

- The proposed file in a code block, with a short comment above each group of rules.
- The evidence for each owner (commit counts from the last year) in one line each.
- Sample path checks, in a small table of path and resulting owner.
- The host settings to change by hand and any handles the user still must confirm.
- Paths with no clear owner, listed so the team can decide instead of guessing.
- A warning for any pattern likely to create a single-person bottleneck.
- Where the file lives and that older copies were removed or none existed.
