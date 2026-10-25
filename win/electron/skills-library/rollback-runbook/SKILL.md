---
name: rollback-runbook
description: Writes a rollback runbook for a service: how to return code, config and data to the last good state, who decides, how long it takes, and what cannot be undone. Use when the user asks how to roll back a release, wants a rollback plan before shipping, or is in the middle of a bad deploy.
---

# Rollback runbook

## Goal

Give the operator exact commands to get back to the last good version and a clear list of what rollback will not fix.

A good runbook has been walked through against the real deploy setup, not written from memory of how it should work.

## When to use

- A release is failing now and the user needs to go back.
- The user wants a rollback plan before a risky release.
- A service has no written recovery path.
- To plan the release steps themselves, use `use_skill` with `deploy-checklist`.

## Steps

1. Find how the service is deployed. Use `search_files` for deploy scripts, CI workflows, Helm charts, `Procfile` and `fly.toml`, and read them with `read_file`.
2. Identify the last known good version: a git tag, an image digest, a release id. Use `run_command` with `git tag --sort=-creatordate` to list tags.
3. If this is an emergency, stop the spread first: pause the rollout, scale new instances to zero or disable the flag, then plan the full return.
4. Write the code rollback commands for this platform. Check the platform docs with `read_url` for the exact command, since flags differ and change.
5. Check the schema. Read the latest migrations with `read_file` and decide whether each is reversible. A dropped column or rewritten data is not.
6. Plan the data path: forward fix, restore from backup, or run a down migration. State the data loss window for each in plain words.
7. Check config and secrets: which values changed in this release and where the old values are kept.
8. Check dependent systems: other services, cached values, queued jobs and scheduled tasks that already used the new version.
9. Write the steps as numbered commands with expected output after each, then a verification block (health, one real flow, error rate).
10. Write the decision rule: who calls it, and the time after which the team stops debugging and rolls back.
11. Rehearse if possible: run each command with `--dry-run` or in staging with `run_command`, and note the real elapsed time.
12. Save it with `create_file` next to the service docs.

## Gotchas

- Rolling back code over a migrated schema can crash the old version. Make migrations backward compatible, then rollback is safe.
- An image tag like `stable` may already point at the bad build. Roll back to a digest or an immutable version.
- Caches, search indexes and queued messages written by the new version stay behind after rollback.
- A rollback that has never been run usually fails on a step nobody remembered, such as lost registry access.
- Rolling back also rolls back the bug fix someone shipped inside the same release. Check the changelog first.
- Flipping a feature flag is faster than any rollback. Say so when the change sits behind one.

## Output

- The runbook as numbered commands with expected results and a verify block.
- A table of what rollback restores and what it does not.
- The time it takes if measured, or marked unmeasured.
