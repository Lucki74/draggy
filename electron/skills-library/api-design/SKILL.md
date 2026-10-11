---
name: api-design
description: "Designs or reviews HTTP APIs (REST or JSON-RPC style) and GraphQL schemas: resources and naming, methods and status codes, errors, pagination, versioning, validation and consistency with the existing API. Use when the user is creating endpoints, designing an API, or wants an API reviewed."
---

# API design

## Start from the existing API

Read the current routes, handlers, schemas (OpenAPI files, GraphQL SDL, route definitions) with search_files and read_file. New endpoints must be consistent with what already exists: naming, casing (camelCase vs snake_case), error format, pagination, authentication. Consistency beats textbook purity.

## REST conventions (where the project has no stronger convention)

- **Resources as plural nouns:** `/orders`, `/orders/{id}`, `/orders/{id}/items`. Actions that do not map to CRUD as sub-resources or verbs sparingly: `POST /orders/{id}/cancel`.
- **Methods:** GET reads (safe, no side effects), POST creates or triggers, PUT replaces, PATCH partially updates, DELETE removes. PUT and DELETE idempotent.
- **Status codes:** 200 OK, 201 Created (with Location), 204 No Content, 400 invalid input, 401 not authenticated, 403 not allowed, 404 not found, 409 conflict, 422 validation failure (if used by the project), 429 rate limited, 500 server error. Never 200 with an error body.
- **Errors:** one consistent shape, for example `{ "error": { "code": "order_not_found", "message": "...", "details": [...] } }`, or RFC 9457 problem details. Machine-readable codes, human-readable messages, no stack traces.
- **Pagination:** cursor-based for large or changing collections, limit/offset for small ones; return the next cursor and cap the page size.
- **Filtering and sorting:** query parameters with documented names.
- **Versioning:** follow the project's approach; otherwise add fields without breaking and version only for breaking changes.
- **Dates:** ISO 8601 in UTC. **IDs:** strings. **Money:** integer minor units or decimal strings, with currency.

## GraphQL

Nullable by default except where guaranteed, connections for pagination, input types for mutations, mutation payloads that return the changed object and user errors, avoid N+1 with data loaders.

## Always

Validate input at the boundary, check authorisation per object, rate-limit expensive or auth endpoints, and make write operations safe to retry (idempotency keys for payments or orders).

## Output

The endpoint or schema design with example requests and responses, notes on each decision, and for reviews a list of inconsistencies and problems ranked by impact. Offer to update the OpenAPI or schema file and to implement it.
