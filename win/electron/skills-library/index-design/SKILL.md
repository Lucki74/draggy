---
name: index-design
description: Chooses database indexes from the real query patterns, deciding columns, order, uniqueness and partial or covering forms while weighing write and storage cost. Use when the user asks what index to add, about composite index order, or says there are too many indexes.
---

# Index design

## Goal

Add the fewest indexes that make the important queries fast, and remove the ones that only cost writes. A good result ties each index to a named query, explains its column order and has been checked against a plan.

## When to use

- A query is slow and an index is suspected.
- The user asks how to order columns in a composite index.
- A table has many indexes and writes are slow.
- For reading the plan that shows the problem, use `use_skill` with `query-plan-reader`.
- For shipping the index to a live database, use `use_skill` with `database-migration`.

## Steps

1. Collect the real queries. Use `search_files` for the table name in the code and ORM calls, and check the slow query log or monitoring if available. List filters, joins, sort order and how often each runs.
2. Inspect existing indexes through the schema files with `read_file`, or with the database's index listing via `run_command`. Note duplicates and indexes that are prefixes of another.
3. For each important query, list the columns by role: equality filters, range filters, sort columns, join keys.
4. Order composite index columns: equality columns first, then the sort columns, then range columns. The index serves queries that use a leftmost prefix of its columns.
5. Consider special forms where the engine supports them: a unique index to enforce a rule, a partial index for a small active subset, a covering index to allow index-only reads, an expression index for a function that queries apply. Check the engine's docs through `read_url` for exact syntax.
6. Judge the cost. Each index slows inserts and updates, takes storage and memory, and is maintained forever. Skip indexes on low-selectivity columns such as booleans on their own.
7. Validate with the plan: create the index in a dev copy, run the analyze form of explain before and after, and confirm the planner picks it.
8. Write the index creation as a migration. On large live tables use the engine's non-blocking build option and check its limits.
9. After release, check the index is actually used with the engine's usage statistics, and remove unused ones later.

## Gotchas

- Column order matters. An index on (a, b) does not help a query that filters only on b.
- Wrapping an indexed column in a function (`lower(email)`, a date cast) stops the plain index being used. Index the expression or rewrite the predicate.
- A leading wildcard in a text search (`LIKE '%term'`) cannot use an ordinary index.
- Implicit type conversion between a column and a parameter can disable the index. Match the types.
- A new index on a busy table can lock writes while it builds on some engines. Use the online option and a quiet window.
- Redundant indexes (a, then a and b) double write cost for little gain. Drop the shorter if no query needs it alone and it is not unique.

## Output

- A list of indexes to add or drop, each tied to a query and with the reasoning for column order.
- The migration SQL and the before and after plan evidence.
- The checks to run after release to confirm use.
