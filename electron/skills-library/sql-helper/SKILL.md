---
name: sql-helper
description: Writes, explains, debugs and optimises SQL queries for PostgreSQL, MySQL, SQLite, SQL Server and others, with correct joins, grouping and safe parameterisation. Use when the user needs a SQL query, has a query error, or wants a query explained or made faster.
---

# SQL helper

## Before writing

- Identify the database engine; syntax differs (LIMIT vs TOP, date functions, string concatenation, upserts). If unknown, ask, or write standard SQL and note engine-specific parts.
- Get the schema: table names, columns, types, keys. In Code, look for it in the project with search_files (migrations, schema files, ORM models) before asking.
- Clarify the grain of the result: one row per what?

## Writing queries

- Use explicit JOIN ... ON, never comma joins. Choose INNER vs LEFT deliberately: LEFT keeps rows without matches.
- Watch for row multiplication when joining one-to-many tables before aggregating; aggregate in a subquery or CTE first if needed.
- Every non-aggregated column in SELECT goes in GROUP BY. Filter groups with HAVING, rows with WHERE.
- NULL: use IS NULL, remember NULL in comparisons is never true, and COUNT(column) skips NULLs.
- Use CTEs (WITH) to make multi-step logic readable.
- Format: keywords uppercase, one clause per line, meaningful aliases.
- In application code, always use parameters (placeholders) for user input, never string concatenation.

## Debugging

Read the error message carefully, find the exact clause, check column names against the schema, then check types and NULL handling. In Code, if a local database is available and the user agrees, run the query with run_command to confirm.

## Performance

Check for indexes on join and filter columns, avoid functions on indexed columns in WHERE, select only needed columns, and suggest reading the EXPLAIN plan. Suggest indexes with the CREATE INDEX statement and the trade-off.

## Output

The query in a code block, then a short explanation of what it does step by step, and any assumptions about the schema. For destructive statements (UPDATE, DELETE, DROP, ALTER), always include the WHERE clause, suggest running a SELECT with the same condition first, and recommend a backup or transaction.
