---
name: readme-writer
description: Writes or revises a project README from the real repository, covering what the project is, how to install and run it, a minimal example, where to get help and how to contribute, with commands run to confirm they work. Use when the user asks for a README, improves one, or wants a project documented for newcomers.
---

# README writer

## Goal

A newcomer understands the project in a minute and has it running in ten. A good README opens with what the project does and for whom, gives install and run steps that were tested, shows one working example, and points to deeper docs without duplicating them.

## When to use

- A repository has no README or an outdated one.
- Contributors keep asking the same setup questions.
- A project is about to be shared or open-sourced.
- For longer documentation sets, use `use_skill` with `documentation`.
- For one task-focused tutorial, use `use_skill` with `how-to-guide`.

## Steps

1. Survey the repo. `list_directory` on the root, then `read_file` on the manifest (package.json, pyproject.toml, Cargo.toml, go.mod and so on), the existing README, CONTRIBUTING, license, CI config and any `docs` folder. Find the entry points, scripts and required runtime versions.
2. Ask with `ask_user` for what the code cannot tell you: who the project is for, its status (experimental, stable, archived), the license intent and where users should get help.
3. Write the opening: the project name, one sentence on what it does and for whom, then two or three sentences on what makes it worth using. State the status honestly.
4. Write the install section from the manifest and the CI config. Give the prerequisites with versions as the project declares them (engines, python_requires, toolchain files), not from memory.
5. Run the steps. In a clean checkout or temp directory, execute install, build and run commands with `run_command`. Fix the README to match what actually happened, including required environment variables (names only, never values).
6. Add a minimal usage example that you ran, with the real output or result. Prefer the smallest example that shows the main use.
7. Add short sections as needed: configuration, how to run tests (confirm with `run_command`), project layout if it is not obvious, and links to docs.
8. Add contributing and license lines that point to the real files. If there is no license file, tell the user rather than claiming one.
9. Check every link and path with `search_files` or `read_url`. Remove sections you cannot fill with real content: empty badges, a roadmap with no items, an acknowledgements stub. Write the file with `create_file` or `edit_file`.
10. Put the quickest path first: a reader who only wants to try it should reach a result before reading configuration.
11. Check the rendering: headings, code fences and relative links display correctly on the host's preview.

## Gotchas

- Install steps that were never run are the most common README fault. A missing flag or old version in the commands costs every new reader time.
- Badges for services the project does not use, or links to dead CI, make the project look abandoned. Include only working ones.
- Copying commands from an older README keeps stale instructions alive. Verify each one.
- Listing every feature leads nowhere. State the main use, then link to detail.
- Secrets in examples, such as real keys or tokens, leak in public repositories. Use placeholder names and say where to get a value.
- Platform differences (Windows paths, shell syntax) change commands. State which platform each block assumes.
- A monorepo needs one README at the root that points to each package's own, not one file that tries to cover everything.
- Screenshots and GIFs go out of date and bloat the repo. Use them for the main flow only and store them lightly.
- A README that repeats the full API reference will drift. Link to generated docs instead.
- State the supported platforms and versions you tested, and say plainly what you did not.
- Use relative links for files in the repo, so they work in forks and on other hosts.

## Output

- The README file, with the sections above that apply.
- A short note on what you ran and what passed, and any step you could not test.
- Questions or gaps for the maintainer, such as missing license or unclear status.
