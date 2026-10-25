---
name: join-keys-check
description: Tests the uniqueness, coverage and type of join keys across tables and predicts row counts before a join runs, so duplicated or vanished rows are caught early. Use when a join doubled the rows, rows went missing after a merge, or before joining two tables.
---

# Join keys check

## Goal

Know what a join will do before it does it. A good check tells the user the relationship between the tables (one to one, one to many, many to many), how many keys match, what the output row count should be, and which key problems to fix first.

## When to use

- A merge returned more rows than the left table, or fewer than expected.
- Two tables from different systems must be combined for the first time.
- Totals changed after a join and nobody knows why.
- For matching records that have no shared ID, use `use_skill` with `dedupe-and-merge`.
- For checking a whole dataset rather than its keys, use `use_skill` with `data-quality-audit`.

## Steps

1. Name the tables, the key columns on each side, and the join the user intends (left, inner, outer) and why. Use `ask_user` if the purpose is unclear. Read the files with `run_code` and print the shape of each.
2. Profile each key column: dtype, number of nulls, number of distinct values, and the number of rows per key. Print the keys with the most rows.
3. Test uniqueness on each side. If the key is unique on both, the join is one to one. If unique on one side only, it is one to many and the output has the many side's row count. If neither is unique, it is many to many and the rows multiply per key.
4. Compare the types and formats. Numbers read as text, leading zeros dropped on one side, trailing spaces, mixed case, a prefix on one system, an extra check digit. Print five unmatched keys from each side next to each other.
5. Measure coverage: the share of left keys found on the right, the share of right keys found on the left, and the count that match. Do this after normalising the keys, and show before and after.
6. Predict the output row count for the planned join type from the above, and compute the sum of a numeric column before the join to compare afterwards. Write both down.
7. Fix problems at the key: normalise, trim, pad, cast to one type, or build a composite key. If duplicates on the right side are the issue, decide with the user which row wins (latest, primary) and deduplicate that table first, logging the rule.
8. Run the join, then verify: the row count equals the prediction, no key explosion, the totals match the control sum, and unmatched rows are accounted for. Keep the unmatched rows in a file for review.
9. Use a validation option if the library has one (for example a check for one-to-one or one-to-many in the merge call) so the assumption is enforced in the code from now on.

```python
print(left[k].is_unique, right[k].is_unique)
m = left.merge(right, on=k, how="left", validate="m:1", indicator=True)
print(len(left), len(m), m["_merge"].value_counts())
```

## Gotchas

- A many-to-many join silently multiplies rows and inflates every sum. The row count looks plausible until a total is compared.
- An inner join drops unmatched rows without a word. Count what was lost and why.
- Null keys never match in most systems, but in some tools null equals null, creating false matches. Check how the tool treats them.
- Float keys such as 1.0 and 1.00000001 fail to match. Keys should be integers or strings.
- Joining on name or address text produces near-matches that are different entities. Use stable IDs where they exist.

## Output

- The relationship found, uniqueness and coverage numbers before and after normalising.
- The predicted and actual row counts, and the control sum check.
- The fixes applied, and the file of unmatched rows.
