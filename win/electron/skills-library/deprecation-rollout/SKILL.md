---
name: deprecation-rollout
description: Plans and executes the retirement of an interface (function, endpoint, option, flag or package) with a replacement, in-code warnings, communication, usage measurement and a removal gated on that measurement. Use when the user wants to deprecate something, plan removal of an old endpoint, or phase out a config option.
---

# Deprecation rollout

## Goal

Move every consumer to the replacement, then remove the old interface with no surprise. The plan has a replacement that already works, a timeline, a way to see who still uses the old path, and a removal that waits on that evidence.

## When to use

- A public or shared interface is to be replaced or removed.
- An internal API has many callers across teams.
- To check whether a planned change is breaking at all, use `use_skill` with `api-breaking-change-check`.
- To remove a whole feature rather than an interface, use `use_skill` with `dead-feature-removal`.
- Two interfaces now do the same job and the older one should go.

## Steps

1. Define what is deprecated, what replaces it, and who the consumers are (internal code, other teams, external users). If there is no replacement, say what users should do instead, and confirm with `ask_user` that removal is truly wanted.
2. Ship the replacement first. Check it covers every real use case of the old interface by reading the old callers with `search_files` and `read_file`. A gap found now is cheap.
3. Mark the old interface in code: a deprecation annotation or doc tag, and a runtime warning where the language allows. The warning names the replacement, the version or date of removal and a link. Emit it once per process or per caller, not per call.
4. Make usage visible. Add a counter or log line on the old path, keyed by caller or client where known, and for internal code list the call sites with `search_files`. Without this you cannot tell when removal is safe.
5. Migrate internal callers yourself with small changes (see `codemod-writer` for bulk changes), so the remaining usage is external.
6. Communicate: the changelog entry, docs update with a migration example, and direct notice to known consumers. Draft these with the user. State the timeline with real dates, based on the project's own release and support policy.
7. Set the removal gate in writing: the date has passed and measured use is zero or acceptably low. Review the counters at the date. If use remains, extend and contact the remaining users instead of removing.
8. Remove the old path, its warning, its tests and its docs. Mention the removal in the changelog under the right version bump. Run the full suite with `run_command`.
9. Provide an automated aid when the migration is mechanical, such as a codemod or a flag that swaps the behaviour in one line.

## Gotchas

- Announcing removal before the replacement ships leaves users with nothing to move to and wastes goodwill.
- A warning on every call floods logs, and people filter it out. Emit once, and make it say what to do.
- Silence does not mean no usage. Clients that rarely run, such as batch jobs and old app versions, show up late. Look at a full cycle of usage.
- Removing on the announced date regardless of data is a decision, and should be made openly. The default is to extend.
- Keep the deprecated path working and tested until removal. A deprecated function that is broken is already removed.
- A deprecation of a default value or behaviour needs the same care as removing a function, and is harder to measure. Add a way to opt in early.
- Semantic versioning promises are part of the plan. Removal in a minor release breaks the promise even with warnings.
- Internal callers count as consumers. Migrating them first shows whether the replacement is truly usable.

## Output

- The deprecation plan: what, replacement, consumers, timeline, measurement and removal gate.
- The code changes (annotation, warning, counter) and the migration guide text.
- The changelog entry and a list of consumers to contact.
- Dates for announce, warn, default-off and remove.
- The next review date for the usage counters.
