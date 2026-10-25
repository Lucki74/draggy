---
name: dead-feature-removal
description: Removes a retired feature end to end, covering code, routes, data, config, flags, tests, docs and translations, in steps that can each be reverted. Use when the user wants a feature removed entirely, is sunsetting something, or wants an old feature flag and its code path deleted.
---

# Dead feature removal

## Goal

After the removal nothing in the repository, the data model or the docs refers to the feature, the remaining product behaves as before, and each removal step is small enough to revert alone.

## When to use

- A feature is retired by decision and the code should go.
- A feature flag has been on (or off) for good and its losing branch is dead.
- To just find unused code without a feature decision, use `use_skill` with `dead-code-finder`.
- To announce and phase out an interface used by others, use `use_skill` with `deprecation-rollout`.
- A product decision has retired a feature but its code still ships in every build.

## Steps

1. Confirm the decision and scope with `ask_user`: which feature, what happens to existing users and their data, and whether there is a date. Removal of user data is a product decision, not yours.
2. Find the footprint. Use `search_files` for the feature's name, its route paths, flag names, table names, event names, translation keys, CSS classes and test names. Use `explore` for entry points you did not think of. List each hit by area.
3. Sort the footprint into layers, outermost first: UI and entry points, API routes and jobs, business logic, data access, schema and stored data, config and flags, tests, docs and translations.
4. Check what depends on it from outside the feature: other features that call its code, shared helpers it owns, scheduled jobs, webhooks and external clients. Anything shared stays and gets a new owner.
5. Take a baseline: build, typecheck and tests with `run_command`.
6. Remove layer by layer, outermost first. For each layer: delete with `delete_file` or `edit_file`, then run build and tests with `run_command`, fix what the removal exposes, and keep the layer in its own commit-sized change.
7. Handle data last, as a separate migration with its own plan (see `database-migration`). Prefer to archive before dropping. Keep the schema removal out of the same release as the code removal.
8. Search again for every name from step 2 and for orphaned imports, unused dependencies and empty files. Remaining hits should be intentional, such as changelog lines.
9. Update docs, translations (every language file), help text and the changelog.

## Gotchas

- Removing code while stored data or old migrations still reference it breaks fresh installs and rollbacks. Keep old migrations intact and add a new one.
- A flag removed from code but still set in a deployed config causes silent drift. Clean the config in each environment.
- Shared helpers look like part of the feature. Check their other callers before deleting them.
- Translations and docs are skipped most often, and translation tests may fail on unused keys. Remove them with the feature.
- Users may have saved links, bookmarks or API clients. Return a clear message or redirect for a period instead of a bare 404.
- Do the removal in the order that keeps each step revertible. Dropping the table first makes the code removal impossible to undo.
- Check analytics before you start. A feature believed dead may have quiet, loyal users, and deleting it is then a communication task.
- Search for the feature in scripts, cron entries and runbooks, which sit outside the usual source folders.

## Output

- The footprint table by layer, with hit counts before and zero after.
- The removal steps in order with test results.
- Data decisions made and still open.
- A list of environments or configs to clean outside the repo.
- Messages or redirects left for users of the old feature.
- Follow-up tasks for data cleanup after the retention period.
