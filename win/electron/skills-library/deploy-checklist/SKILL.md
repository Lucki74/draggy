---
name: deploy-checklist
description: Builds a deploy checklist from the actual change: migrations, config, flags, dependencies and traffic effects, with checks before, during and after the release and a defined abort point. Use when the user asks for a deploy checklist, wants to know what to verify before shipping, or is preparing a risky release.
---

# Deploy checklist

## Goal

Turn a vague "ship it" into a short ordered list the person can follow while tired, with a clear point where they stop and roll back.

A good checklist is built from this diff, not copied from a generic template.

## When to use

- The user is about to deploy and wants to know what to check.
- The release has a migration, a config change or a new dependency.
- A team wants a repeatable list for a service.
- For undoing a release, use `use_skill` with `rollback-runbook`.

## Steps

1. Read the change: `git_diff` against the last released tag, or `run_command` with `git log --oneline <tag>..HEAD`. List files that touch schema, config, infra, dependencies and public API.
2. Ask with `ask_user` what the deploy target is, who is on call, and whether traffic is low at the planned time, only if the repository does not say.
3. Find migrations with `search_files` for `migrations` and `ALTER`. Mark any that lock tables or cannot be reversed.
4. Find new environment variables with `search_files` on `process.env` and `os.environ` in the diff. List where each must be set before the deploy.
5. Find feature flags and mark the default state in production.
6. Write Before: tests green, build artifact identified by version, backups taken if data changes, config set, on call informed, rollback path confirmed.
7. Write During: the order of steps (migration, then app, or the reverse), what to watch, and the minutes to wait between stages.
8. Write After: health endpoints, one real user path tested by hand, error rate and latency compared with the hour before, queue depth, logs for new error types.
9. Define the abort rule with numbers the team agrees on, for example the error rate at which they stop. Do not invent thresholds; ask or leave a blank to fill.
10. Note who decides to roll back and where the rollback steps live.
11. Use `update_plan` to track the list if the user is deploying with you now.
12. Offer to save the list with `create_file` as `docs/deploy-<version>.md`.

## Gotchas

- Deploying app code before a migration that it needs, or the reverse, is the classic ordering failure. State the order explicitly.
- A green health endpoint proves the process is up, not that checkout or login works.
- A change that is safe alone can fail with the old version still running during a rolling deploy. Check both versions against the new schema.
- Friday evening and holiday deploys fail more painfully because nobody is around to fix them. Say so once.
- A checklist with 40 items is skipped. Keep what this change needs and drop the rest.
- Secrets added to the pipeline but not to the runtime show up only after traffic arrives.

## Output

- A Before, During and After checklist with checkboxes, ordered, with the abort rule at the top.
- The riskiest item called out in one line.
- Unknowns listed as questions for the user.
