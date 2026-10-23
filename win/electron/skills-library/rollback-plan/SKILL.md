---
name: rollback-plan
description: Defines the exact steps, decision triggers and time limit for undoing a risky change, covering code, data, config and dependants, and checks each step can really be run before the change ships. Use when the user asks for a rollback plan, how to undo a release if it fails, or wants a way back for a migration or deploy.
---

# Rollback plan

## Goal

A written way back that someone on call can follow at a bad hour. It names who decides, what signal triggers it, the ordered steps, the point after which rollback is no longer possible, and what was verified in advance.

## When to use

- Before shipping a migration, a large release, a config change or an infrastructure change.
- A reviewer asks "what if this goes wrong?"
- For planning the change itself, use `use_skill` with `database-migration` or `framework-upgrade-plan`.
- For a gradual cutover with a built-in switch, use `use_skill` with `strangler-migration`.
- A change cannot be feature-flagged and has to ship all at once.

## Steps

1. List everything the change touches: application code, database schema and data, configuration and secrets, infrastructure, queues and caches, external systems, and clients in the field. Read the change with `git_diff`, and the deploy config with `read_file`.
2. For each item, decide whether it can be reversed and how:
   - Code and config: redeploy the previous version or revert the commit.
   - Additive schema changes: usually safe to leave in place when old code ignores them.
   - Destructive schema or data changes: not reversible without a backup, so require a verified backup or split the change into expand and contract phases.
   - Messages already sent, emails, charges and external API calls: cannot be recalled. Note the compensating action.
3. Identify the one-way doors: the step after which going back means data loss or an outage. Mark that point in the plan, and add a check before it.
4. Define triggers with numbers the team already watches: error rate, latency, failed jobs, support tickets, a failed health check, plus a time limit (for example, decide within 30 minutes of release). Name who may call it, and make it allowed without a meeting.
5. Write the steps as commands and clicks in order, each with its expected result and how to verify. Use exact commands found via `search_files` in the deploy scripts or runbooks. Put them in a file with `create_file` if the user agrees.
6. Check data compatibility both ways: can the old code read data written by the new code during the window? If not, plan feature flags, dual writes or a freeze.
7. Rehearse. Run the steps in a staging environment or on a copy with `run_command`, including restoring the backup if the plan depends on one. Record the time taken.
8. Plan the aftermath: communication to users and teams, a record of what happened, and what must be reconciled in data written during the window.

## Gotchas

- Redeploying old code is rollback only when data and schema stay compatible. New columns, changed formats and migrated rows often make the old code fail.
- A backup never restored is a hope. Prove the restore, and time it, because duration decides whether it is practical.
- A plan that depends on the person who wrote it fails at night. Keep steps explicit and place the plan where on-call finds it.
- No trigger and no owner means nobody pulls the cord, and the incident grows. Name both before release.
- Feature flags help only if the flag service is up and the flagged code path is tested in both positions.
- Caches, CDNs and queues keep serving or processing new-version artefacts after code is reverted. Include flushes and drains.
- Rolling back an upgrade can leave client apps out of sync with the server. Check minimum versions and old clients.
- Test the rollback with the migration data volume. A step that takes a second on staging can take hours on real tables.

## Output

- A one-page plan: scope, one-way doors, triggers and owner, ordered steps with checks, aftermath.
- The rehearsal result with timings, or a clear note that it was not rehearsed.
- Open gaps the user must close before shipping.
- Who was told about the plan and where it is stored.
