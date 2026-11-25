---
name: how-to-guide
description: Writes a step-by-step how-to guide that takes a reader from a stated starting point to a working result, with prerequisites, one action per step, expected results and fixes for common failures, and runs the steps where possible. Use when the user asks for a how-to guide, a tutorial, or step by step instructions.
---

# How-to guide

## Goal

A stranger follows the guide once and gets the result. A good guide states what the reader needs before starting, gives numbered steps with one action each and the expected outcome, and covers the failures that really happen.

## When to use

- A task needs written instructions for users, teammates or customers.
- The user has notes or a demo and wants it as a guide.
- For project onboarding in a repository, use `use_skill` with `readme-writer`.
- For a post that teaches a technique and argues for it, use `use_skill` with `technical-blog`.

## Steps

1. Define the task in one line, written as the reader's goal ("Set up a staging site on a new domain"). Ask with `ask_user` who the reader is, what they already know, and what system, version and operating system the guide targets.
2. Collect the real procedure from the user, their notes, or the project files with `read_file`. If the steps can be run safely, run them yourself with `run_command` in a scratch directory and record exact commands and output.
3. List prerequisites: accounts, tools with versions, permissions, files and time needed. Check versions with the tool itself, such as a version flag, not memory. Where a version or menu may have changed, check the live documentation with `read_url`.
4. Write steps. One action per step, starting with a verb, naming the exact control, command or file. Put commands in code blocks. After any step with a visible result, say what the reader should see.
5. Add a decision only where the path really branches, and handle each branch with its own short sequence. Avoid nested options.
6. Insert a check after each stage: a command to run or a thing to look for that confirms the stage worked. This is what lets a reader find where they went wrong.
7. Write a troubleshooting section from failures you saw while running the steps or that the user knows: the symptom as the reader sees it (an error message in full), the cause, and the fix.
8. Add a short end state: what the reader has now, and one or two natural next steps. Do not summarise the steps.
9. Re-run the finished guide from a clean state if possible. Fix every place where you had to guess or skip. Save with `create_file` if wanted.
10. Add a short "before you start" note for risky steps: what to back up and what cannot be undone.
11. Note the date and the versions the guide was verified against, near the top.

## Gotchas

- A guide never run by its author carries errors that only appear at step six. Run it, or say clearly which parts were not tested.
- Unstated prerequisites are the top reason readers quit. If a step assumes an installed tool or a permission, say it before step one.
- Two actions in one step ("open settings and enable sync") hide where a reader got stuck. Split them.
- Screenshots and menu names go stale. Name the control by its label, note the version, and mention where it sits only if needed.
- Copy-paste commands with placeholder values risk running with the placeholder. Mark placeholders clearly and say what to replace.
- Never include real secrets, tokens or personal data in example commands.
- Instructions for several operating systems balloon fast. Pick the main one, and link to separate guides for the others.
- A step that says "configure as needed" hides the actual decision. Name the setting and give a sensible value.
- Long waits (builds, downloads, propagation) need a note on how long to expect, or readers will interrupt them.
- Destructive commands in a guide, such as deletes and force flags, need a warning right before them.
- Reusing your own environment's paths in examples breaks for others. Use neutral placeholders.

## Output

- The guide: title, who it is for, prerequisites, numbered steps with checks, troubleshooting, end state.
- A note on what was tested, in which environment and version, and what was not.
- Questions still open for the author, such as an unconfirmed menu name.
