---
name: changelog
description: Writes release notes and changelog entries from git history since the last release, grouped for readers (added, changed, fixed, breaking) and in the project's existing changelog format. Use when the user prepares a release, asks for release notes, or wants the changelog updated.
---

# Changelog and release notes

## Gather

1. Find the previous release: `git describe --tags --abbrev=0` or `git tag --sort=-creatordate | head -5` with run_command.
2. List what changed since: `git log <last-tag>..HEAD --oneline --no-merges`. For unclear commits, read them with `git show --stat <sha>` and the diff.
3. Read the existing CHANGELOG.md, RELEASES.md or similar and copy its format exactly: headings, version and date style, tone, link style. If there is none, use the Keep a Changelog layout below.

## Write for users, not for git

- Group by effect: **Added**, **Changed**, **Fixed**, **Removed**, **Security**, **Deprecated**. Put **Breaking changes** first, with what users must do.
- Describe the effect in user terms: "Exports no longer drop the last row" rather than "fix off-by-one in exporter loop".
- Merge several commits about the same change into one entry.
- Leave out internal-only changes (refactors, CI, tests, typo fixes in comments) unless the project's changelog includes them.
- Credit contributors or link PRs and issues if the existing changelog does.

## Version number

If the project uses semantic versioning, suggest the next version: major for breaking changes, minor for new features, patch for fixes only. Do not create tags or releases unless asked.

## Output

The new section, then insert it at the top of the changelog file with edit_file if the user wants the file updated. Also offer a short announcement version (3 to 5 bullets) for a release page or social post.

Keep a Changelog layout, if needed:

```
## [1.4.0] - 2025-06-02
### Added
- ...
### Fixed
- ...
```
