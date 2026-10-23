---
name: orm-n-plus-one
description: Detects N+1 query patterns caused by ORM lazy loading, proves them by counting queries, and fixes them with joins, batched loading or restructured access. Use when the user reports too many queries per request, an N+1 problem, or a slow ORM-backed page.
---

# ORM N+1 queries

## Goal

One request issues a small, predictable number of queries regardless of list size. A good result shows the query count before and after, uses the loading method that fits each case and adds a guard against the problem returning.

## When to use

- A list page or endpoint gets slower as rows are added.
- Logs show the same query repeated with different ids.
- For reading the plan of a single slow query, use `use_skill` with `query-plan-reader`.
- For caching results instead of reducing queries, use `use_skill` with `caching-strategy`.

## Steps

1. Pick the endpoint or page. Turn on query logging or the ORM's debug output for a local run, using `run_command` to start the app or a test. Record the number and text of queries for one request.
2. Spot the pattern: one query for the list, then one query per item for a related record or count. Increase the list size and confirm that the query count grows with it.
3. Find the source in code. Use `search_files` to locate the loop, serializer, template or resolver that touches the relation, and `read_file` to see where the lazy access happens. It is often hidden in a serializer, a property method or a template.
4. Choose the fix for each relation:
   - A to-one relation: join or eager load it in the original query.
   - A to-many relation: load in a second batched query by the collected ids (select-in style) instead of a huge join that multiplies rows.
   - A count or sum per item: compute it with one grouped query or an annotation.
5. Load only the columns you need. Fetching full rows for a tree of relations can be heavier than the queries it replaces.
6. Apply with `edit_file`, using the ORM's documented loading options. Check the current docs with `read_url` for the installed version, since option names differ.
7. Re-run with logging. Confirm the count is now constant and the result is identical.
8. Add a test that asserts the maximum query count for the endpoint with a larger seeded dataset, if the project's test tools allow it.

## Gotchas

- Eager loading everything everywhere fixes the lists and slows the single-record views that never needed the data. Load per use case.
- Joining several to-many relations in one query multiplies rows (a cartesian product). Batch each to-many relation separately.
- Tests with three seeded rows show no problem. Use dozens of rows, or assert on the query count.
- Lazy access hidden in a serializer or a template means the fix belongs there or in the query that feeds it, not in the controller you are staring at.
- Pagination on a joined to-many query paginates the joined rows, not the parents. Paginate the parent ids first.
- Changing the loading strategy can change result order or duplicates. Compare outputs before and after.

## Output

- Query counts before and after for the same request and dataset size.
- The code changes, one line each, naming the relation fixed.
- The test or guard added, and any endpoint left unfixed.
