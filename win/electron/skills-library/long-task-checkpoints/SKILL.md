---
name: long-task-checkpoints
description: Sets checkpoints in long multi-step work where state is saved, verified and reported, so a failure, a stop or a context reset loses little and the work can resume from the last good point. Use when the user says a task will take a while, asks to work in stages, or when a job has many steps with side effects.
---

# Long task checkpoints

## Goal

Make long work resumable and safe. At each checkpoint the state is verified and recorded, and the user knows where things stand. A crash or a stop costs one stage, not the whole job.

## When to use

- A job has many steps, runs long or processes many items.
- Each step changes files, data or remote state.
- The user wants periodic check-ins, or wants to stop and continue later.
- To split the work in the first place, use `use_skill` with `task-decomposer`.
- To hand work to a new session at a checkpoint, use `use_skill` with `context-handoff`.

## Steps

1. Divide the work into stages that each end in a state you can describe and test: "all 40 files converted and the build passes". Agree the stage list with the user using `ask_user` if the job is large or risky.
2. Pick the checkpoint rule for each boundary: what is saved (a commit-ready diff, an output file, a progress record), what is checked (tests, counts, a spot check), and what is reported.
3. Before the first stage, record the starting point. Run `git_status` and note the branch and clean or dirty state, or copy the inputs somewhere safe if no version control exists. This is the undo path.
4. Keep a progress file with `create_file`: stage, status, items done, items left, last verified time. For per-item work, record each item as it finishes, so a restart skips what is done.
5. Work through the stage. Use `update_plan` to show the current stage and keep one in progress.
6. At the boundary, run the checks with `run_command`. If they fail, fix or roll back to the last checkpoint before going on. Do not stack stages on a failing base.
7. Report in a few lines: stage done, what was checked, what is next. Ask for a go-ahead only where the next stage is risky or the user asked for approval at each boundary.
8. Make stages idempotent where possible, so rerunning a stage after an interruption does not duplicate work or corrupt data.
9. On a stop or error, write the exact state to the progress file, say how to resume, and name the first command to run.

## Gotchas

- A checkpoint without a check is just a message. Verify something real.
- Check-ins at every small step interrupt the user. Match the frequency to the risk.
- Progress files that are written only at the end are useless after a crash. Update as you go.
- Resuming from a half-finished stage can double-apply changes. Make items idempotent or record partial state.
- Large outputs and logs hide the state. Keep the progress file short and put detail elsewhere.
- Remote side effects (emails sent, records changed) cannot be rolled back with git. Checkpoint before them and ask first.

## Output

- The stage list with current status.
- The last verified checkpoint and the checks that passed.
- The progress file path and how to resume.
- The next stage and whether it needs the user's go-ahead.
