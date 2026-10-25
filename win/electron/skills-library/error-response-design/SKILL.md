---
name: error-response-design
description: Defines one consistent error response shape for an API and maps failures to status codes, machine-readable codes and safe messages. Use when the user asks to standardize error responses, which status code to return, or to design API errors.
---

# Error response design

## Goal

Every failure from the API has the same body shape, a correct status code and a stable code a client can switch on. A good result lets a client show the right message without parsing English, and never leaks internals.

## When to use

- Endpoints return errors in different shapes or with wrong status codes.
- The user is designing a new API's error contract.
- For internal exception handling inside services, use `use_skill` with `error-handling-review`.
- For form-level display of errors in a UI, use `use_skill` with `form-validation-ux`.

## Steps

1. Survey what exists. Use `search_files` for error handlers, thrown error classes and `res.status` or equivalent calls. Read the central handler with `read_file`. List the distinct shapes in use.
2. Check for a standard to follow. Many teams use the problem-details format for HTTP APIs. Check the current RFC with `read_url` before citing field names, and prefer it unless the project has a strong convention.
3. Define the shape. Typical fields are a stable machine `code`, a human `message`, an HTTP `status`, an optional `details` list for field errors and a `requestId` for support. Keep it small.
4. Build a catalogue of codes: one per distinct client-actionable situation (`validation_failed`, `not_found`, `conflict`, `rate_limited`, `unauthorized`). Avoid a code per internal exception class.
5. Map each to a status. 400 or 422 for invalid input, 401 for missing or bad credentials, 403 for not allowed, 404 for absent, 409 for state conflicts, 429 for throttling, 500 for unexpected, 503 for temporarily unavailable.
6. Centralize it in one error handler or middleware. Handlers throw typed errors, and the handler turns them into responses. Edit with `edit_file`.
7. Make unexpected errors safe: log the full error with the request id on the server and return a generic message to the client.
8. Field errors: give path, code and message per field so clients can attach them to inputs.
9. Update tests and the API docs to the new shape, and run the suite with `run_command`.

## Gotchas

- Returning 200 with an error body hides failures from caches, proxies, monitors and client libraries.
- Messages that include SQL, file paths, stack frames or "user not found" versus "wrong password" help attackers. Keep auth errors uniform.
- Clients that match on message text break when the wording is edited. Document that `code` is stable and `message` is not.
- Changing an existing error shape is a breaking change for clients. Version it or ship the old and new fields together for a period.
- 404 for an object the caller may not see avoids revealing that it exists. Decide this per resource and keep to it.
- Mixing validation (400) and semantic failure (422) without a rule confuses consumers. Pick one rule and write it down.

## Output

- The error schema with an example for validation, not-found and server errors.
- The code-to-status table.
- The handler changes and the list of endpoints still using the old shape.
