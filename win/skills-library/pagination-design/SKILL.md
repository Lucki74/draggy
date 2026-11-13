---
name: pagination-design
description: Chooses between offset, page and cursor pagination for an API list endpoint and implements it with stable ordering, limits and a clear response shape. Use when the user asks to add pagination, asks whether to use cursors or offsets, or says a list endpoint is slow.
---

# Pagination design

## Goal

Return large lists in pages that are fast at any depth, consistent while data changes and impossible to abuse. A good result states the chosen method with its reason, enforces a maximum page size and has tests for the page boundaries.

## When to use

- A list endpoint returns everything, or is slow on large tables.
- The user asks which pagination style to use.
- For writing the query behind it, use `use_skill` with `sql-helper`.
- For the index that the sort needs, use `use_skill` with `index-design`.

## Steps

1. Read the endpoint and its query with `read_file`. Note the table size, the current sort, filters and the client's needs (jump to page 50, infinite scroll, export).
2. Choose the method. Offset and page number are simple and allow jumping, but slow down deep and can skip or repeat rows when data changes. Cursor (keyset) pagination is fast and stable for feeds and large tables, but cannot jump to an arbitrary page.
3. Define a total order. Sort by the requested field plus a unique tie-breaker such as the primary key. Without a unique key rows can appear twice or vanish between pages.
4. For cursors, encode the last row's sort values into an opaque token (base64 of a small structure). Build the query with a tuple comparison on the sort columns, not offset.
5. Set `limit` with a default and a hard maximum. Reject or clamp values outside the range, and reject negative or non-numeric input.
6. Shape the response: `items`, plus `next_cursor` (null at the end) or page and total fields. Add a total count only if the client needs it, since counting large tables is expensive.
7. Make sure an index supports the order and filter. Check the plan with `run_command` and the database's explain command, or use `use_skill` with `query-plan-reader`.
8. Implement with `edit_file`, then test: empty result, exactly one page, a partial last page, an insert during paging, an invalid cursor.
9. Document the parameters and the response in the API docs or spec.

## Gotchas

- Offset pagination on a feed that gets new rows shows duplicates on the next page. Cursor pagination avoids it.
- Sorting by a non-unique column such as `created_at` without a tie-breaker drops or repeats rows that share a value.
- A cursor that exposes raw ids or values invites tampering. Treat it as opaque, and validate it on use.
- `COUNT(*)` for a total on every request can cost more than the page itself. Offer it only on demand or approximate it.
- A maximum page size missing from the code lets one request pull the whole table. Enforce it server-side.
- Changing the sort or filters while holding an old cursor produces nonsense. Tie the cursor to the query shape and reject mismatches.

## Output

- The chosen method and a two-line reason.
- The request and response shape with an example.
- The code changes, the index needed and test results.
