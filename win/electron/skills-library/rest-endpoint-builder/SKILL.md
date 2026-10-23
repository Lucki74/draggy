---
name: rest-endpoint-builder
description: Adds one REST endpoint to an existing backend by following the codebase's own routing, validation, error and test conventions. Use when the user asks to add an endpoint, build a REST route or create a POST handler for a resource.
---

# REST endpoint builder

## Goal

Add a working endpoint that looks like it was written by the team that owns the code: same layering, same validation library, same error shape, with tests. A good result is small, covered by tests and does not invent new patterns.

## When to use

- The user asks for a new route, handler or resource endpoint.
- The user wants an existing endpoint extended with a new method or field.
- For deciding the shape of a whole API first, use `use_skill` with `api-design`.
- For the error format itself, use `use_skill` with `error-response-design`.
- For list endpoints that need paging, use `use_skill` with `pagination-design`.

## Steps

1. Confirm the contract. State method, path, request fields, response fields and expected status codes. Use `ask_user` for anything the request leaves open, such as who may call it.
2. Find the closest existing endpoint with `search_files` (a route of similar shape). Read it and its neighbours with `read_file`: router registration, handler, validation schema, service or data layer, tests.
3. Note the conventions: where validation happens, how errors are thrown or returned, how auth is attached, how responses are serialized, naming of paths (plural nouns, casing).
4. Write the validation first. Reject unknown or malformed input at the boundary and give field-level errors, using the project's validation approach.
5. Put business logic in the service or domain layer the project already has, and keep the handler to parsing, calling and responding.
6. Add the route to the router with the right auth and permission checks. Check ownership of the resource on every read and write. A logged-in caller is not enough.
7. Pick status codes deliberately: 201 with a location for creation, 200 or 204 for updates and deletes, 400 or 422 for bad input, 404 for a missing resource, 409 for conflicts.
8. Write tests with `create_file` or `edit_file`: success, validation failure, missing auth, forbidden access, not found. Run them with `run_command`.
9. Call the endpoint for real if a dev server is available, using `run_command` with a command line HTTP client, and compare the output with the contract.

## Gotchas

- Checking that a user is logged in without checking that the record belongs to them lets anyone read or edit anyone's data by changing an id.
- Returning the database row directly leaks internal columns such as password hashes, flags and foreign keys. Serialize through an explicit shape.
- A handler that does a read, a check and then a write without a transaction or constraint is racy. Let a unique constraint settle duplicates.
- Accepting the full body into a model (mass assignment) lets callers set fields like `role` or `owner_id`. Whitelist fields.
- Status 200 with `{ "error": ... }` breaks client libraries and monitoring that rely on status. Use the status code.
- Adding the route but not the OpenAPI or docs entry leaves the contract out of date. Check whether the project generates or hand-writes it.

## Output

- The files changed or created, with a one-line purpose each.
- The final contract: method, path, request, response, status codes.
- Test results and anything not verified, such as behaviour against a real database.
