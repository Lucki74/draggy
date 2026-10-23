---
name: graphql-schema-review
description: Reviews a GraphQL schema and its resolvers for naming, nullability, pagination, authorization and cost, and lists concrete changes. Use when the user asks to review a GraphQL schema, has GraphQL performance problems, or wants help designing GraphQL types.
---

# GraphQL schema review

## Goal

A schema that is clear to clients, evolves without breaking them and cannot be turned into a denial of service by one query. A good review ranks findings and ties each to a type, field or resolver.

## When to use

- The user shares a GraphQL schema or codebase and wants it reviewed.
- Queries are slow, or a client can fetch far more than intended.
- For REST-style design questions, use `use_skill` with `api-design`.
- For per-item query explosions in resolvers, use `use_skill` with `orm-n-plus-one`.

## Steps

1. Find the schema files and resolvers. Use `search_files` for SDL files, type definitions and resolver maps, then `read_file` them. Note whether the schema is written first or generated from code.
2. Check naming and structure: consistent casing, nouns for types, verb-led mutation names, mutations that take a single input type and return a payload type with the changed object and any user errors.
3. Check nullability. Fields that can fail or be missing should be nullable so one failure does not null the whole parent. Fields that always exist should be non-null. Look for schemas where everything is one or the other.
4. Check lists. Large collections should use cursor-based connections with a bounded `first` argument instead of plain lists. Look at how page sizes are capped.
5. Check evolution: use deprecation with reasons instead of removals, avoid boolean arguments that will need a third state, and prefer enums that tolerate new values on the client.
6. Check authorization in resolvers or a shared layer. Field-level checks matter, since a query can reach a type through many paths. Look for checks that exist only on the top-level query.
7. Check cost controls: query depth limit, complexity or cost analysis, a limit on aliases and batch size, and persisted or allowlisted queries where clients are known. Introspection exposure in production is a decision to state.
8. Check resolver efficiency: batching and caching per request for lookups by id, so list fields do not trigger a query per item.
9. Check error handling: user-facing failures as typed fields in payloads, internal errors masked, and no stack traces in responses.
10. Write findings with example queries that demonstrate the risk, and run the schema through the project's validation or tests with `run_command`.

## Gotchas

- A deeply nested query on mutually related types can request millions of nodes. Without depth and cost limits one request can take the server down.
- Making everything non-null feels strict but turns one failed field into an error that wipes out the whole parent object.
- Authorization done only at the root misses paths through relations. Enforce it where the data is resolved.
- Removing or renaming a field breaks clients you cannot see. Deprecate first and check usage from query logs.
- Returning generic strings for errors forces clients to parse text. Use typed error payloads or error codes.
- Using the database model as the GraphQL type exposes internal columns and locks the API to the storage layout.

## Output

- Findings ranked by risk, each with the field or resolver, a sample query and the fix.
- A short list of what is good, so it is kept.
- Things not reviewed, such as the client code and the deployment.
