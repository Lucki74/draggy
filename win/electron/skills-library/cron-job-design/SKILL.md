---
name: cron-job-design
description: Designs or repairs scheduled jobs: a correct schedule and time zone, a lock against overlap, idempotent work, timeouts, failure alerts and a heartbeat that proves the job ran. Use when the user asks to set up a cron job, reports jobs running twice or silently failing, or wants to know when a nightly task breaks.
---

# Scheduled job design

## Goal

A scheduled job runs when intended, exactly once in effect, and someone finds out when it does not.

A good job can be run again by hand after a failure without causing damage.

## When to use

- A new recurring task is being added.
- A job overlaps itself, runs on two servers, or stopped without anyone noticing.
- A job must catch up after downtime.
- For general shell script safety, use `use_skill` with `shell-script`.

## Steps

1. Find existing schedules with `search_files` for `crontab`, `schedule:`, `cron`, `CronJob` and scheduler libraries, and read them with `read_file`.
2. Write the schedule in the scheduler's syntax and say it in words back to the user. Check the cron expression with the docs via `read_url` if the scheduler has quirks.
3. Set the time zone explicitly. State whether it uses UTC and what happens on daylight saving changes for a local time.
4. Make the work idempotent: key writes by a run or business date, use upserts, and record processed ids so a rerun does nothing twice.
5. Prevent overlap: a lock (database advisory lock, file lock, platform concurrency policy set to forbid) with an expiry longer than the longest run.
6. Run in one place only. With several app instances, use a single scheduler or a lock so each tick runs once.
7. Add a timeout and a clear exit code. Log the start, end, counts and duration as structured lines.
8. Handle missed runs after downtime: decide between skip, run once on start, or backfill by date range, and write that decision down.
9. Add monitoring: ping a heartbeat URL at success, alert if the ping is missing past the expected interval, and alert on non-zero exit.
10. Make sure the job's environment has what it needs: cron runs with a minimal `PATH` and no shell profile. Use absolute paths.
11. Test by running the command by hand with `run_command` twice in a row, and once with a forced failure.
12. Document how to rerun a specific date safely.

## Gotchas

- Cron's minimal environment is why a script works in a terminal and fails from cron. Use absolute paths and set variables explicitly.
- A job scheduled at 02:30 local time may run twice or never on daylight saving change days.
- Alerting only on failure misses the job that never started. Alert on the absence of success.
- Retries without idempotency send duplicate emails or charge twice.
- Containers with several replicas each start the in-process scheduler, so the task runs once per replica.
- A long run that exceeds its interval stacks processes until memory is gone.

## Output

- The schedule in plain words with time zone, lock, timeout and rerun behaviour.
- Files created or edited.
- The monitoring signal that proves success, and the test results.
