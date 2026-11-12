---
name: changelog
description: Writes release notes and changelog entries from git history since the last release, grouped for readers (added, changed, fixed, breaking) and in the project's existing changelog format. Use when the user prepares a release, asks for release notes, or wants the changelog updated.
---

# Changelog and release notes

## Goal

Turn the commits since the last release into entries a user can read: grouped by effect, written in user terms, and formatted like the project's existing changelog.

## When to use

- The user is preparing a release or asks for release notes.
- The user wants CHANGELOG.md updated.
- For a single commit message, use `use_skill` with `commit-message`.

## Steps

1. Find the previous release with `run_command`: `git describe --tags --abbrev=0`, or `git tag --sort=-creatordate | head -5`.
2. List what changed since: `git log <last-tag>..HEAD --oneline --no-merges`. For unclear commits, read `git show --stat <sha>` and the diff.
3. Read the existing CHANGELOG.md, RELEASES.md or similar with `read_file` and copy its format exactly: headings, version and date style, tone, link style. If there is none, use the Keep a Changelog layout below.
4. Group by effect: **Added**, **Changed**, **Fixed**, **Removed**, **Security**, **Deprecated**. Put **Breaking changes** first, with what users must do.
5. Describe each effect in user terms. Write "Exports no longer drop the last row" rather than "fix off-by-one in exporter loop".
6. Merge several commits about the same change into one entry. Credit contributors or link PRs and issues if the existing changelog does.
7. Suggest the next version if the project uses semantic versioning: major for breaking changes, minor for new features, patch for fixes only.

Keep a Changelog layout, if needed:

```
## [1.4.0] - 2025-06-02
### Added
- ...
### Fixed
- ...
```

## Gotchas

- Commit subjects describe mechanics, not effects. Read the diff when a subject says only "fix" or "update".
- Leave out internal-only changes (refactors, CI, tests, typo fixes in comments) unless the project's changelog includes them.
- A breaking change buried under Changed is how users get surprised. Breaking changes go first.
- Do not create tags or releases unless asked.
- Merge commits and squashed PRs can hide several changes in one subject. Check the PR when the count looks too low.

## Output

The new section. If the user wants the file updated, insert it at the top of the changelog with `edit_file`. Offer a short announcement version of 3 to 5 bullets for a release page or social post.
