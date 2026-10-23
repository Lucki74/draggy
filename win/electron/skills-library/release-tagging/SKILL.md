---
name: release-tagging
description: Chooses the next version number from the commits since the last release, creates an annotated git tag on the right commit, and pushes it without disturbing published tags. Use when the user asks to tag a release, wants to know what version number comes next, or needs a git tag for v1, v2 or a hotfix.
---

# Release tagging

## Goal

Put one correct, immutable version tag on the commit that is actually released. A good result has a version number justified by the changes, an annotated tag with a short message, and a push that touches only that tag.

## When to use

- The user is ready to cut a release and needs the next version.
- A hotfix or backport needs its own tag on a release branch.
- The user is unsure whether a change is major, minor or patch.
- For the release notes that go with the tag, use `use_skill` with `changelog`.
- For the branch rules around releases, use `use_skill` with `branch-strategy`.

## Steps

1. Check readiness. `git_status` must be clean and on the branch the release comes from. Run `git fetch --tags` and `git status -sb` with `run_command` to confirm the branch matches its remote.
2. Find the last release: `git describe --tags --abbrev=0` and `git tag --sort=-v:refname -n | head` through `run_command`. Learn the project's existing scheme first (a `v` prefix, pre-release suffixes, calendar versions) and follow it.
3. List what changed: `git log --oneline <last-tag>..HEAD`. Read the subjects, and `git diff --stat <last-tag>..HEAD` for scale.
4. Pick the bump if the project uses semantic versioning. Major for a breaking change to a public interface, minor for added behavior that stays compatible, patch for fixes only. Name the commit that forces the choice. If the project is pre-1.0 or uses another scheme, say so and follow its convention. Where unclear, ask with `ask_user`.
5. Check version files. Search with `search_files` for the old version string in package manifests, changelog headings and docs. Update them in a commit before tagging, so the tag contains the right numbers.
6. Confirm the target commit: `git rev-parse HEAD` and the CI status of that commit. Do not tag a commit whose build is red.
7. Create an annotated tag, not a lightweight one: `git tag -a v1.4.0 -m "v1.4.0"`. Add `-s` only if the team signs tags and a key is set up. Add a one-line message, no body, unless the project's habit differs.
8. Show it: `git show v1.4.0 --stat`. Check the tagged commit hash.
9. Push only the tag with `git push origin v1.4.0` after the user agrees. Never use `git push --tags`, which pushes every local tag, stray ones included.
10. If the host builds releases from tags, watch for the pipeline to start, and tell the user where to look.

## Gotchas

- A published tag must never move. If you tagged the wrong commit after pushing, make a new version. Deleting and recreating a pushed tag leaves other clones and package caches with the old target.
- Lightweight tags carry no date, author or message, and `git describe` ignores them by default. Use annotated tags for releases.
- Tag order is not version order. `git tag` sorts alphabetically, so v1.10.0 appears before v1.2.0. Use `--sort=-v:refname`.
- Tagging a merge commit on the default branch is fine, but a tag made on a feature branch and later rebased points at a commit that no longer exists on any branch.
- Pre-release tags such as `-rc.1` sort before the final version in semver but not always in the host's UI. Check how the tooling orders them.
- Tag names with slashes or spaces create trouble in URLs and scripts. Stick to the form the project already uses.
- If the stable-release rules (what counts as breaking) are not written anywhere, do not invent them. Ask, or cite the project's documented policy.

## Output

- The proposed version with one sentence of reasoning that names the deciding commit.
- The tag command and its message, and the commit it points at.
- The files updated for the version bump, if any.
- Whether the tag is local only or pushed, and what the pipeline will do next.
- Stray local tags found that should not be pushed, if any.
- The release-notes step as a pointer, not a repeat of the changelog work.
- If the scheme was ambiguous, the assumption you made so the user can correct it.
