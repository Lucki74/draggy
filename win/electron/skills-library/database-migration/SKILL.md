---
name: database-migration
description: Plans and writes database schema migrations that are safe on existing data and running systems, using expand-and-contract steps, batched backfills, non-blocking indexes and a tested rollback. Use when the user needs to change a database schema, add or rename a column or table, change a column type, or migrate data.
---

# Database migration

## Goal

Change the schema or data without breaking running code, losing rows or locking a busy table. A good result is a set of migration files that apply cleanly, roll back cleanly, and come with a deployment order and notes on locking.

## When to use

- The user wants to add, rename, retype or drop a column or table.
- The user needs an index, constraint or foreign key on an existing table.
- The user wants existing data transformed or moved.

## Steps

1. Understand the setup:
   - The migration tool: Prisma, Drizzle, TypeORM, Knex, Sequelize, Alembic, Django, Rails, Flyway, Liquibase, golang-migrate, sqlx, EF Core, or plain SQL files. Find it with `search_files` and read two recent migrations with `read_file` to match their style.
   - The database engine and version, and whether the change will run against production data with live traffic.
   - The size of the affected tables, if known. Big tables change what is safe.
2. Choose the safe pattern:
   - **Adding a column:** nullable, or with a default that does not rewrite the table on your engine version. Backfill separately in batches, then add NOT NULL.
   - **Renaming a column or table (expand and contract):** add the new column; write to both and backfill old to new; switch reads to the new column; stop writing the old one; drop the old column in a later release.
   - **Changing a type:** new column plus backfill, never an in-place conversion that can fail halfway on a large table.
   - **Indexes on large tables:** `CREATE INDEX CONCURRENTLY` on PostgreSQL (outside a transaction), online DDL options on MySQL.
   - **Foreign keys and constraints:** on PostgreSQL, add as NOT VALID then VALIDATE separately for big tables.
   - **Dropping anything:** only after code no longer uses it and a backup exists.
   - **Data migrations:** batched, idempotent (safe to re-run) and logged.
3. Write the migration. Use the tool's generator command if it has one (`run_command`), then review and edit the generated file with `edit_file`. Write both up and down, or document why down is impossible, such as dropped data. Update models, types and queries in the code to match.
4. Test it. Run the migration against a local or test database with `run_command`, roll it back, re-apply it to prove the rollback works, then run the tests.

## Gotchas

- Never run a migration against a production database yourself.
- `CREATE INDEX CONCURRENTLY` fails inside a transaction. Many tools wrap migrations in one by default, so turn that off for this file.
- A default on a new column rewrites the whole table on some engine versions. Check the version before assuming it is instant.
- Dropping a column in the same release that stops using it breaks the old code still running during the deploy.
- A down migration that drops a column cannot bring the data back. Say so instead of pretending it is reversible.

## Output

The migration files, the deployment order if there are several steps, the expected locking and duration concerns, how to roll back, and any manual step (backup, maintenance window).
