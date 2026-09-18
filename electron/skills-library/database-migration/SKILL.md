---
name: database-migration
description: "Plans and writes database schema migrations that are safe on existing data and running systems: expand-and-contract steps, backfills, indexes without locking, and a tested rollback. Use when the user needs to change a database schema, add or rename columns or tables, or migrate data."
---

# Database migration

## Understand the setup

- The migration tool: Prisma, Drizzle, TypeORM, Knex, Sequelize, Alembic, Django, Rails, Flyway, Liquibase, golang-migrate, sqlx, EF Core, or plain SQL files. Find it with search_files and read two recent migrations to match their style.
- The database engine and version, and whether the change will run against production data with live traffic.
- The size of affected tables, if known: big tables change what is safe.

## Safe patterns

- **Adding a column:** nullable, or with a default that does not rewrite the table on your engine version. Backfill separately in batches, then add NOT NULL.
- **Renaming a column or table (expand and contract):**
  1. Add the new column.
  2. Write to both, backfill old to new.
  3. Switch reads to the new column.
  4. Stop writing the old one.
  5. Drop the old column in a later release.
- **Changing a type:** new column plus backfill, never an in-place conversion that can fail halfway on large tables.
- **Indexes on large tables:** `CREATE INDEX CONCURRENTLY` on PostgreSQL (outside a transaction), online DDL options on MySQL.
- **Foreign keys and constraints:** add as NOT VALID then VALIDATE separately on PostgreSQL for big tables.
- **Dropping anything:** only after code no longer uses it, and after a backup exists.
- **Data migrations:** batched, idempotent (safe to re-run), and logged.

## Write it

1. Use the tool's generator command if it has one (run_command), then review and edit the generated file.
2. Write both up and down (or document why down is impossible, such as dropped data).
3. Update models, types and queries in the code to match.
4. Run the migration against a local or test database with run_command, then roll it back and re-apply to test the rollback, then run the tests. Never run migrations against a production database yourself.

## Report

The migration files, the deployment order if there are several steps, the expected locking and duration concerns, how to roll back, and any manual step (backup, maintenance window).
