---
name: api-design
description: Designs or reviews HTTP APIs (REST or JSON-RPC style) and GraphQL schemas, covering resources and naming, methods and status codes, errors, pagination, versioning, validation and consistency with the existing API. Use when the user is creating endpoints, designing an API, or wants an API reviewed.
---

# API design

## Goal

Produce an API that clients can predict: consistent with what the project already exposes, correct about methods and status codes, and safe by default. For a review, produce a ranked list of what is inconsistent or wrong.

## When to use

- The user is adding endpoints or designing a new API or GraphQL schema.
- The user wants existing routes, an OpenAPI file or a schema reviewed.
- For building the endpoint once the design is agreed, use `use_skill` with `add-feature`.

## Steps

1. Start from the existing API. Read the current routes, handlers and schemas (OpenAPI files, GraphQL SDL, route definitions) with `search_files` and `read_file`. New endpoints must match what exists: naming, casing (camelCase or snake_case), error format, pagination and authentication. Consistency beats textbook purity.
2. Apply these REST conventions where the project has no stronger one:
   - **Resources:** plural nouns, such as `/orders`, `/orders/{id}`, `/orders/{id}/items`. Actions that do not map to CRUD become sub-resources, or verbs used sparingly: `POST /orders/{id}/cancel`.
   - **Methods:** GET reads (safe, no side effects), POST creates or triggers, PUT replaces, PATCH updates part of a resource, DELETE removes. PUT and DELETE are idempotent.
   - **Status codes:** 200 OK, 201 Created (with Location), 204 No Content, 400 invalid input, 401 not authenticated, 403 not allowed, 404 not found, 409 conflict, 422 validation failure (if the project uses it), 429 rate limited, 500 server error.
   - **Errors:** one consistent shape, for example `{ "error": { "code": "order_not_found", "message": "...", "details": [...] } }`, or RFC 9457 problem details. Machine-readable codes, human-readable messages, no stack traces.
   - **Pagination:** cursor-based for large or changing collections, limit and offset for small ones. Return the next cursor and cap the page size.
   - **Filtering and sorting:** query parameters with documented names.
   - **Versioning:** follow the project's approach. Otherwise add fields without breaking anything, and version only for breaking changes.
   - **Formats:** dates in ISO 8601 UTC, IDs as strings, money as integer minor units or decimal strings together with the currency.
3. For GraphQL: fields nullable by default except where guaranteed, connections for pagination, input types for mutations, mutation payloads that return the changed object and user errors, data loaders to avoid N+1 queries.
4. Check the basics on every design: input validated at the boundary, authorisation checked per object, rate limits on expensive or auth endpoints, and write operations safe to retry (idempotency keys for payments or orders).

## Gotchas

- Returning 200 with an error body breaks every client that trusts the status code.
- A "better" convention that differs from the rest of the API costs clients more than the inconsistency it fixes.
- Authorisation checked only on the collection route lets users reach other people's records through `/items/{id}`.
- Offset pagination on a collection that changes while users page through it skips or repeats rows.
- Retrying a POST that creates a payment or order without an idempotency key creates duplicates.

## Output

The endpoint or schema design with example requests and responses and a note on each decision. For reviews, a list of inconsistencies and problems ranked by impact. Offer to update the OpenAPI or schema file and to implement the design.
