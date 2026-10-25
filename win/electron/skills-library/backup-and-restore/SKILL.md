---
name: backup-and-restore
description: Designs a backup plan with recovery point and time goals, schedule, retention, separate storage, encryption and monitoring, and verifies it by restoring into a scratch environment. Use when the user asks to set up backups, choose retention, or check that a backup can really be restored.
---

# Backup and restore

## Goal

Make sure the data can come back, how much would be lost, and how long it takes.

A backup that has not been restored is a hope. A good plan includes the restore test and its result.

## When to use

- A service holds data worth keeping and has no tested backup.
- The user asks how often to back up or how long to keep copies.
- Before a risky migration or hardware change.
- For the release rollback side, use `use_skill` with `rollback-runbook`.

## Steps

1. Inventory what holds state with `search_files` for database config, volume mounts, upload paths and object storage names, and read deploy files with `read_file`.
2. Ask with `ask_user` for the recovery point objective (how much data loss is acceptable) and recovery time objective (how long can it be down). Do not invent them.
3. Choose the method per store: database dumps or continuous log archiving, volume snapshots, object versioning. Check the exact tool options in current docs via `read_url`.
4. Set the schedule from the recovery point objective, and the retention in tiers: daily recent, weekly, monthly. Ask what the business needs to keep, and what privacy rules say about deleting.
5. Store copies away from the source: another account, region or provider, with delete protection or object lock against ransomware and mistakes.
6. Encrypt backups and keep the key somewhere that survives the loss of the main environment.
7. Write the backup script or config with `create_file`, with exit codes, logs and a timeout. For databases take a consistent snapshot, not a file copy of live data.
8. Add monitoring: alert if no new backup appeared in the expected window or if the size falls sharply.
9. Run a restore test into a scratch database or host with `run_command`. Record time taken, row counts or checksums compared with the source, and any missing piece.
10. Write the restore steps as a runbook, including where credentials and keys are, and who may run it.
11. Schedule a repeat restore test, for example quarterly.
12. Report gaps: stores that are not covered.

## Gotchas

- Copying database files while the database runs yields a corrupt backup. Use the engine's dump or snapshot method.
- Backups stored beside the data, with the same credentials, die with it.
- Backup jobs that exit zero after writing an empty file look healthy. Check size and run a content check.
- Retention that only grows becomes a cost problem, and one that is too short removes the clean copy before corruption is noticed.
- Restores fail on version mismatches and missing extensions. Test with the same versions as production.
- Uploaded files and secrets live outside the database and are often the forgotten half.

## Output

- The plan table: store, method, frequency, retention, location, encryption.
- Restore test evidence with elapsed time and checks.
- Gaps and the monitoring added.
