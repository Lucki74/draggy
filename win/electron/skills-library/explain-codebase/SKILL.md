---
name: explain-codebase
description: Gives a guided tour of an unfamiliar project covering what it does, how it is organised, the main flows through the code, how to run and test it, and where to start for a given task. Use when the user says "explain this codebase", "how does this project work", "where do I start" or "how does this part work".
---

# Explain a codebase

## Goal

Help the user understand a project well enough to work in it. A good tour is proportionate to the project, uses file paths the user can open, and says what was not looked at.

## When to use

- The user is new to a project or a part of it.
- The user asks how something in a codebase works or where to start for a task.
- For tracking down a specific failure, use `use_skill` with `debugging`.

## Steps

1. Top level: run `list_directory` on the root. Read the README, AGENTS.md or CONTRIBUTING.md, and the manifest (package.json, pyproject.toml, Cargo.toml, go.mod, pom.xml, *.csproj) with `read_file` for the language, framework, scripts and dependencies.
2. Entry points: find where execution starts, such as main files, app bootstrap, server setup, CLI entry, routes and index files. `search_files` helps ("main(", "createServer", "app.listen", "@app.route").
3. Structure: list the main folders and what each holds, one level deeper where it matters.
4. Follow one real flow end to end. Pick the core use case (a request, a command, a button press) and follow it through the files, reading only what that path touches.
5. For questions that would take many reads, ask `explore` ("Where is authentication checked?") and use its answer as a lead to verify.
6. Find how to run it: build, run and test commands from scripts, Makefile, docs or CI config.
7. Stop exploring once you can explain the parts the user cares about.
8. Explain, in this order:
   1. **What it is:** one paragraph on purpose, users and main technologies.
   2. **Map:** the key folders and files, each with one line.
   3. **How it works:** the main flow as numbered steps naming the files and functions involved.
   4. **Key concepts:** domain terms, core data models, important patterns or conventions.
   5. **Run and test:** exact commands.
   6. **Where to start:** for the user's task if they mentioned one, the files to read or change first. Otherwise good first areas.

## Gotchas

- Read only. Do not modify anything while exploring.
- Describing files you did not open is guessing. Say what you did not look at.
- Reading everything wastes effort. Follow one flow and read only what it touches.
- Commands copied from the README may be out of date. Check them against the scripts and CI config.
- A small script gets a short answer. Do not inflate the tour.

## Output

The six-part explanation above, with file paths the user can open, scaled to the size of the project.
