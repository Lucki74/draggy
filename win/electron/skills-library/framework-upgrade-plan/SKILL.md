---
name: framework-upgrade-plan
description: Plans a major framework or runtime upgrade from the current release notes and migration guide into ordered, individually testable steps with a baseline, a stop point and a rollback. Use when the user asks to plan the move to the next major version, what will break on upgrade, or how to sequence a framework migration.
---

# Framework upgrade plan

## Goal

Turn "we should upgrade" into an ordered plan where each step leaves the project building and tested. The plan rests on the current official migration guide and on what this codebase actually uses, not on remembered changelogs.

## When to use

- A major version of a framework, runtime or build tool is the target.
- The user wants an estimate and an order before touching code.
- For a single package bump with a small surface, use `use_skill` with `dependency-upgrade`.
- For schema or data changes triggered by the upgrade, use `use_skill` with `database-migration`.
- Support for the current version is ending and a date has been set by the vendor.

## Steps

1. Record the current versions of the framework, runtime, plugins and build tools from the manifest and lockfile with `read_file`. Record the target version and the date you checked it.
2. Fetch the live sources with `read_url` or `search_web`: the official upgrade guide, release notes for every major in between, the support and end-of-life dates, and the compatibility table for your plugins. Cite the pages in the plan. Do not rely on memory for versions or removed APIs.
3. Make a baseline on a clean branch. Run install, build, typecheck, lint and tests with `run_command` and save the results. If the baseline is red, fix or list it first, so upgrade failures are not mixed with old ones.
4. Measure the exposure. For each breaking change in the guide, use `search_files` to count where this codebase uses the affected API. Make a table: change, hits, effort, risk. Changes with zero hits drop off the list.
5. Check the surroundings: Node or runtime version, TypeScript or compiler version, test runner, CI images, Docker base images, deployment platform support, and plugins with no release for the target version.
6. Order the steps. Typical order: raise the runtime if needed, update tooling that supports both versions, apply compatible changes under the old version where possible, bump the framework, fix breaks, then adopt new features later. Write the steps with `update_plan`, each with an exit check.
7. Decide how to go in stages when possible: a compatibility layer, codemods from the vendor (see `codemod-writer` for writing your own), or running two versions side by side during the move.
8. Define the stop point and rollback: the version to return to, what to revert, and what data or build artefacts the new version touches that the old cannot read. Use `use_skill` with `rollback-plan` for the full version.
9. Present the plan with estimates as ranges and unknowns named. Confirm scope and timing with `ask_user`.

## Gotchas

- Skipping a major version's notes because the guide jumps to the latest loses removals made in between. Read each major.
- Upgrading framework and plugins together makes failures impossible to place. Move one layer at a time where the tools allow.
- A lockfile regenerated from scratch can bump hundreds of transitive packages. Keep the lockfile diff reviewable.
- Deprecation warnings under the old version are a free to-do list. Fix them before the bump.
- Build output, SSR behaviour and defaults can change with no API change, so passing unit tests do not cover the upgrade. Plan a smoke test of the real app.
- Estimates that count only code edits ignore CI, docs, training and the time plugins take to catch up.
- Upgrade guides list breaking changes, not behaviour that merely differs. Run the real app and its main flows after each step.
- A green CI on the new version proves little if CI skips slow or browser tests. Check what the pipeline actually runs.

## Output

- A plan: versions, sources with dates, exposure table, ordered steps with exit checks, rollback.
- Open risks and unknowns, and the decision needed from the user.
- The baseline results the later steps will compare against.
- Sources consulted with the date each was read.
- Estimate as a range, with what the range depends on.
