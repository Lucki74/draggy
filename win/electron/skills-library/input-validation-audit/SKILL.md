---
name: input-validation-audit
description: Audits every place the application accepts data (routes, forms, headers, files, queues, webhooks) for missing schema validation, size limits, type confusion and unsafe use downstream. Use when the user asks to audit input handling, check that user data is validated, or harden an API.
---

# Input validation audit

## Goal

Make sure data is checked at the edge against an explicit allow list before the rest of the code trusts it.

A good audit lists each entry point, what is validated, and where the data goes next.

## When to use

- An API or form handler reads request data directly.
- A bug report involves odd input crashing a handler.
- A validation library is to be introduced.
- For SQL specifically, use `use_skill` with `sql-injection-check`.

## Steps

1. Inventory entry points with `explore` or `search_files`: route definitions, controllers, GraphQL resolvers, message consumers, webhook handlers, CLI arguments, file readers and environment reads.
2. For each, read the handler with `read_file` and write down every field it reads: body, query, path, header, cookie, file.
3. Check for an explicit schema (zod, joi, pydantic, JSON Schema, bean validation). Flag handlers that read fields directly without one.
4. Check types and shapes: strings that must be numbers, arrays where one value is expected, nested objects, and extra unexpected keys that get copied into a model (mass assignment).
5. Check limits: maximum length of strings, size of bodies, number of array items, page size, and numeric ranges. Missing limits are denial of service surface.
6. Check format rules by allow list: identifiers, emails, URLs, enums, dates. Prefer parsing into a typed value over testing with a regex.
7. Follow each value to its sink: a query, a shell command, a file path, an HTML template, a redirect, a log line, an outbound request.
8. Match the sink with the right defence: parameters, argument arrays, path normalisation with a base directory check, contextual output encoding, allow-listed redirect targets.
9. Check validation runs on the server. Client checks are convenience only.
10. Check error handling: invalid input returns a clear client error, not a stack trace or a 500.
11. Add or propose schemas with `edit_file` for the highest risk handlers first, and add tests with hostile cases.
12. Report coverage as a count: entry points checked, covered, gaps.

## Gotchas

- Blocklists of bad characters are bypassed by encoding tricks. Validate with allow lists and encode at the output.
- Validating before decoding, or decoding twice, lets encoded payloads slip past the check.
- JSON parsers accept duplicate keys and large numbers differently, so two layers can disagree about the value.
- Mass assignment: passing a whole request body to an ORM `create` lets users set `isAdmin` or `ownerId`.
- Header values such as `Host` and `X-Forwarded-For` are input too, and often reach redirects and logs.
- Sanitising and validating are different jobs. Silently changing input can hide attacks and corrupt legitimate data.

## Output

- An entry point table: route or topic, fields, validation present, sink, gap.
- Fixes ordered by risk, with code for the top ones.
- Hostile test cases added or proposed.
