---
name: api-breaking-change-check
description: Compares a public interface before and after a change and lists what would break existing callers, including signatures, behaviour, formats, defaults and error codes. Use when the user asks if a change is breaking, whether it is backwards compatible, or what a diff does to API consumers.
---

# API breaking change check

## Goal

Give a clear answer to "who breaks if this ships?". The result lists each change to the public contract, who it affects and whether it needs a major version, a deprecation path or only a note.

## When to use

- A diff touches exported functions, types, HTTP routes, CLI flags, config keys, events or file formats.
- The user must pick a version bump or write release notes.
- To design a new interface rather than check a change, use `use_skill` with `api-design`.
- To check the effect of upgrading a package you consume, use `use_skill` with `dependency-upgrade`.
- A rollout runs old and new versions at the same time, and both must accept each other's data.

## Steps

1. Define the contract surface. Ask what outside code touches: package exports, REST or IPC endpoints, CLI, config files, stored data, events. Use `read_file` on the entry points and docs, and `search_files` for exports.
2. Get the change with `git_diff`, or read old and new versions of the files. For a released package, fetch the previous published API with `run_command` or `read_url` instead of trusting memory.
3. Build a before and after list per item: name, parameters and types, return shape, thrown errors, defaults, ordering guarantees, side effects.
4. Classify each difference:
   - Breaking: removed or renamed item, new required parameter, narrower accepted input, changed return type, changed error type or status code, changed default.
   - Behavioural: same signature, different result, timing, ordering, limits or rounding.
   - Safe: new optional parameter, new item, wider accepted input, new field in a response that clients ignore.
5. Look for internal consumers with `search_files`. Update or list them. External consumers you cannot see are the real risk; say so.
6. Check serialised forms: database columns, JSON keys, saved settings, cache entries, URLs. Old data must still load.
7. Recommend: the version bump, a compatibility shim or deprecation alias if cheap, and the text for the changelog.
8. Where possible run the old tests or examples against the new code with `run_command` to confirm the verdict.
9. If the project has contract tests, schema files (OpenAPI, protobuf, JSON Schema) or a typed client, run their diff or compatibility tool with `run_command` and attach the output.
10. State the assumptions: who the consumers are, whether versions are pinned, and whether an old and new version run side by side during deploy.

## Gotchas

- Adding a required field to a request, or a value to an enum that clients switch on, breaks callers although it looks additive.
- Behaviour behind an unchanged signature is the most missed break. Read the body as well as the declaration.
- Changing a default value is a breaking change for everyone who relied on it.
- Error messages and codes count as contract when clients parse them.
- Tightening validation breaks inputs that used to pass. So does a new rate limit or size cap.
- Types that compile fine in the repo can still break consumers in other languages that read the same JSON.

## Output

- A table: item, before, after, class (breaking, behavioural, safe), affected consumers.
- Verdict and recommended version bump.
- Migration notes for consumers, ready for the changelog.
- Assumptions about consumers, written down so the user can correct them.
