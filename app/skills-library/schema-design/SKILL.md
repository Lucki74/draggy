---
name: schema-design
description: Models entities, keys, relations and constraints for a feature or review of an existing database schema, choosing types that hold up under real data. Use when the user asks to design the tables for a feature, how to model some data, or to review a schema.
---

# Schema design

## Goal

A schema that states its rules in the database, handles the data the feature will really see and can change later without pain. A good result has clear entities, enforced keys and constraints, fitting types and a note on how it will be queried.

## When to use

- A new feature needs tables, or an existing model feels wrong.
- The user wants an existing schema reviewed.
- For changing a live schema safely, use `use_skill` with `database-migration`.
- For choosing indexes after the model is set, use `use_skill` with `index-design`.

## Steps

1. Gather the facts: the entities in plain words, how they relate (one to many, many to many), expected volumes, the main read and write queries and which rules must always hold. Use `ask_user` for gaps. Read the current schema or migrations with `read_file` and match naming.
2. Define each entity as a table with a primary key. Choose the key type deliberately: a surrogate integer or UUID for most tables, and a natural key only when it is truly stable and unique.
3. Model relations with foreign keys and decide the delete behaviour for each: restrict, cascade or set null. Use a join table with a composite key for many to many, plus extra columns when the relation has attributes.
4. Pick types carefully. Use an exact decimal or integer minor units for money, a timezone-aware timestamp for instants, proper date types, enums or lookup tables for closed sets, and the right text length policy for the engine.
5. Move rules into the database: NOT NULL, UNIQUE, CHECK constraints and foreign keys. Application code can be bypassed, constraints cannot.
6. Normalize to avoid contradictory copies of the same fact. Denormalize on purpose only for a measured read need, and record where the source of truth is.
7. Add audit columns that the project uses (created and updated times, who) and decide on soft delete versus real delete, noting what each does to unique constraints.
8. Walk the main queries against the model: can each be answered with sensible joins and indexes? Sketch the indexes needed.
9. Write the DDL with `create_file` in the project's migration format, and review it once more for names and nullability.

## Gotchas

- Storing a list in one text column (comma separated ids, JSON array of foreign keys) prevents joins, constraints and indexes. Use a child table unless the data is truly opaque.
- Floating point for money gives rounding errors. Use exact types.
- Timestamps without timezone information lose meaning when servers or users move. Store instants in UTC with zone-aware types.
- A unique constraint combined with soft delete blocks re-creating a deleted value. Use a partial unique index over active rows.
- Nullable columns that are in fact required spread null checks through the code. Make them NOT NULL and give defaults.
- Over-general designs (one table with type and value columns for everything) are slow, unconstrained and hard to query. Model the real entities.

## Output

- The entity list and relations in a few lines, then the DDL.
- A list of constraints and why each exists.
- Open questions and the queries the design was checked against.
