---
name: explain-codebase
description: "Gives a guided tour of an unfamiliar project: what it does, how it is organised, the main flows through the code, how to run and test it, and where to start for a given task. Use when the user is new to a codebase or asks how a project or part of it works."
---

# Explain a codebase

## Explore efficiently

1. **Top level:** list_directory on the root. Read README, AGENTS.md or CONTRIBUTING.md, and the manifest (package.json, pyproject.toml, Cargo.toml, go.mod, pom.xml, *.csproj) for the language, framework, scripts and dependencies.
2. **Entry points:** find where execution starts: main files, app bootstrap, server setup, CLI entry, routes, index files. search_files helps ("main(", "createServer", "app.listen", "@app.route").
3. **Structure:** list the main folders and what each holds, one level deeper where it matters.
4. **One real flow end to end:** pick the core use case (a request, a command, a button press) and follow it through the files, reading only what that path touches.
5. For questions that would take many reads, ask explore ("Where is authentication checked?") and use its answer as a lead to verify.
6. **Running it:** build, run and test commands from scripts, Makefile, docs or CI config.

Read, do not modify anything. Stop exploring once you can explain the parts the user cares about; say what you did not look at.

## Explain

1. **What it is:** one paragraph: purpose, users, main technologies.
2. **Map:** the key folders and files, each with one line.
3. **How it works:** the main flow as numbered steps naming the files and functions involved.
4. **Key concepts:** domain terms, core data models, important patterns or conventions.
5. **Run and test:** exact commands.
6. **Where to start:** for the user's task if they mentioned one, the files to read or change first; otherwise good first areas.

Use file paths the user can open, and keep it proportionate: a small script gets a short answer.
