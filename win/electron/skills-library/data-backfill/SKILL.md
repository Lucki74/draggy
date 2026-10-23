---
name: data-backfill
description: Designs and runs a backfill that fills in or corrects existing records in small, resumable, verifiable batches, with a dry run, throttling and counts that prove completeness. Use when the user needs to backfill a new column, fix rows after a migration, or populate old records with a new field.
---

# Data backfill

## Goal

Every existing record that should have the new or corrected value ends up with it, no record is changed twice with a different result, and the database stays healthy while it runs. The run can stop and resume at any point and ends with numbers that prove it finished.

## When to use

- A new column, field or derived value must be populated for historical rows.
- A bug wrote wrong data and the stored values need correcting.
- For the schema change itself, use `use_skill` with `database-migration`.
- For the plan to undo it if it goes wrong, use `use_skill` with `rollback-plan`.

## Steps

1. Define the rule in one sentence: which records are selected, how the new value is computed, and what to do with records that cannot be computed. Read the schema and the code that writes the field with `read_file` and `search_files`, so the backfill and live writes follow the same rule.
2. Make live writes correct first. New and updated records must already carry the right value, or the backfill chases a moving target. Deploy that change before the run.
3. Count the target set with a read-only query through `run_command`: total rows, rows needing change, rows that are null, odd or very large. Keep these numbers.
4. Write the job as a script file with `write_file`. Properties it needs:
   - Batches by primary key range or a cursor, with a size you can change.
   - Each batch in its own short transaction.
   - A pause between batches and a stop file or flag to halt it.
   - Idempotent update: it only touches rows still needing the change, so reruns are safe.
   - Progress saved (last key processed) so it resumes after a crash.
   - Logs of counts per batch and of rows skipped with the reason.
5. Test on a copy or a small slice. Run with a dry-run flag that reports what would change. Compare ten or twenty changed rows by hand against the rule.
6. Run in production with a small batch first. Watch database load, lock waits and replication lag. Raise the batch size only if the metrics stay healthy. Ask the user with `ask_user` before the full run and about the time window.
7. Verify at the end with a query for rows still needing the change (expected zero or the known skipped set), and compare totals against step 3. Spot-check a sample across the id range, including the oldest rows.
8. Record what was run, the dates, the counts and the script's location. Remove the temporary index or flag used by the job when it is done.

## Gotchas

- One large update statement locks rows or the table for the whole run and can stall production. Batch it.
- A job that is not idempotent doubles effects on retry, such as appended text or incremented counters. Design the update as a set to a computed value.
- Computing the value in application code with row-by-row reads is slow. When the value derives from the same row, one batched SQL update is faster and safer.
- Triggers, search indexes, caches and event streams fire on every updated row. A backfill can flood downstream systems. Check what listens before starting.
- Rows created during the run might be missed or double handled. Re-count at the end and rerun the selection to catch them.
- Test data rarely contains the ugly production rows: nulls, legacy formats, huge text. Look at real distributions in step 3.
- Keep the original values somewhere (a copy column or a table) until the new values are accepted, if the change is lossy.

## Output

- The rule, the script path and its flags.
- Counts before, during and after, and the skipped set with reasons.
- The verification queries and their results.
- Cleanup tasks left.
