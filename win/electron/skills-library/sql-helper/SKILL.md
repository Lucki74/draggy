---
name: sql-helper
description: Writes, explains, debugs and optimises SQL queries for PostgreSQL, MySQL, SQLite, SQL Server and others, with correct joins, grouping and safe parameterisation. Use when the user needs a SQL query, has a query error, wants a query explained, or asks why a query is slow.
---

# SQL helper

## Goal

Deliver a query that returns exactly the rows the user wants on their database engine, with the reasoning shown. For broken or slow queries, find the cause and fix it.

## When to use

- The user needs a new SQL query.
- A query fails, returns wrong rows or runs slowly.
- The user wants a query explained.
- For changing a live schema, use `use_skill` with `database-migration`.

## Steps

1. Identify the database engine. Syntax differs (LIMIT vs TOP, date functions, string concatenation, upserts). If unknown, ask, or write standard SQL and mark the engine-specific parts.
2. Get the schema: table names, columns, types, keys. In a project, look for it with `search_files` (migrations, schema files, ORM models) before asking.
3. Clarify the grain of the result: one row per what?
4. Write the query:
   - Use explicit JOIN ... ON, never comma joins. Choose INNER vs LEFT deliberately, since LEFT keeps rows without matches.
   - When joining one-to-many tables before aggregating, rows multiply. Aggregate in a subquery or CTE first if needed.
   - Every non-aggregated column in SELECT goes in GROUP BY. Filter groups with HAVING and rows with WHERE.
   - For NULL, use IS NULL. A comparison with NULL is never true, and COUNT(column) skips NULLs.
   - Use CTEs (WITH) to make multi-step logic readable.
   - Format with uppercase keywords, one clause per line and meaningful aliases.
   - In application code, use parameters (placeholders) for user input, never string concatenation.
5. To debug, read the error message, find the exact clause, check column names against the schema, then check types and NULL handling. If a local database is available and the user agrees, run the query with `run_command` to confirm.
6. For performance, check for indexes on join and filter columns, avoid functions on indexed columns in WHERE, select only needed columns, and suggest reading the EXPLAIN plan. Propose indexes with the CREATE INDEX statement and state the trade-off.

## Gotchas

- Joining a one-to-many table before aggregating inflates sums and counts without any error.
- `col = NULL` matches nothing. Use IS NULL.
- A LEFT JOIN with a filter on the right table in WHERE silently turns into an inner join. Put that condition in ON.
- Building SQL by concatenating user input invites injection.
- UPDATE or DELETE without a WHERE clause changes every row.

## Output

The query in a code block, then a short step-by-step explanation and any assumptions about the schema. For destructive statements (UPDATE, DELETE, DROP, ALTER), always include the WHERE clause, suggest running a SELECT with the same condition first, and recommend a backup or transaction.
