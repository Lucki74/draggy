---
name: openapi-spec-writer
description: Writes or repairs an OpenAPI document from code, traffic or a design, with reusable schemas, error responses and validation. Use when the user asks to write an OpenAPI spec, document an API, or says their swagger file is wrong.
---

# OpenAPI spec writer

## Goal

Produce a spec that matches what the API really does and passes a validator, so clients, docs and tests can trust it. A good result has accurate paths, schemas that are reused, documented errors and an honest list of what could not be confirmed.

## When to use

- The user wants a spec for an API that has none, or wants an old one corrected.
- A generated client or docs page misbehaves because the spec is wrong.
- For designing the API before writing the spec, use `use_skill` with `api-design`.
- For the shape of error bodies, use `use_skill` with `error-response-design`.

## Steps

1. Check which OpenAPI version the project uses or wants, and whether the spec is generated from code or written by hand. Search with `search_files` for existing spec files and framework decorators. Check current spec details with `read_url` if a feature is in question.
2. Inventory the routes. Read the router and handlers with `read_file` and list method, path, path and query parameters, request body, responses and auth for each.
3. Define reusable components first: schemas for each resource, shared parameters (id, page, limit), the security scheme and one error schema. Reference them with `$ref` instead of copying.
4. Write each operation with a unique `operationId`, a short summary, tags, parameters, a request body where relevant and every response the code can return.
5. Document the error responses that handlers actually produce: 400, 401, 403, 404, 409, 422 and 429 where they apply, using the shared error schema.
6. Mark required fields, nullable fields, formats (`date-time`, `uuid`), enums and min and max where the validation code enforces them. Copy constraints from the real validators, do not guess.
7. Add examples that are realistic and valid against the schema.
8. Validate with a linter or validator through `run_command`, such as one the project already has. If none exists, check which tool is current with `search_web` before suggesting an install.
9. Spot check three operations against the live or local service with `run_command` to confirm responses match.

## Gotchas

- A spec written from memory of the code drifts. Verify against handlers and, where possible, real responses.
- Using one schema for create, update and read forces read-only fields like `id` into requests. Define separate request and response shapes, or use read-only markers.
- Leaving out error responses makes generated clients treat every non-success as an untyped exception.
- Nullable and optional are different. A field that may be missing is not the same as a field that may be null.
- Duplicate `operationId` values break client generators silently or with confusing names.
- Wide use of `additionalProperties: true` or empty schemas hides the contract. Use them only where the data is truly free-form.

## Output

- The spec file path, created or edited with `create_file` or `edit_file`.
- The validator result and the operations spot checked.
- A list of behaviours you could not confirm and the assumptions made.
