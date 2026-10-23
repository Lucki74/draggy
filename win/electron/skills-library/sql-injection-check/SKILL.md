---
name: sql-injection-check
description: Finds queries built by string concatenation or interpolation in SQL, ORM raw calls and NoSQL filters, traces whether untrusted input reaches them, and rewrites them with parameters and allow lists. Use when the user asks to check for SQL injection, review a query, or fix string built queries.
---

# SQL injection check

## Goal

Remove every path where outside text can change the structure of a database query.

A good fix uses parameters for values and allow lists for identifiers, and is covered by a test.

## When to use

- Code uses raw SQL, query builders or ORM escape hatches.
- A security scanner flagged a query.
- The app accepts sort fields, filters or search text from users.
- For validating input generally, use `use_skill` with `input-validation-audit`.

## Steps

1. Find the database layer with `search_files` for `SELECT `, `INSERT `, `UPDATE `, `DELETE `, `execute(`, `query(`, `raw(`, `$queryRawUnsafe`, `text(` and `.format(` near SQL.
2. List every site that builds a query from variables: template strings, `+` concatenation, `%` formatting, `f` strings.
3. Read each site with `read_file` and trace backwards: where does each variable come from. Mark ones that can come from a request, file, queue or another user's stored data.
4. Rewrite values as bound parameters using the driver's placeholder style (`?`, `$1`, `:name`, `%s` as a parameter marker, not formatting). Use `edit_file`.
5. Handle identifiers (column names, sort order, table names), which cannot be parameters: map the user's choice through a fixed allow list to a known column.
6. Handle `LIKE`: parameterise the whole pattern and escape the wildcard characters if literal matching is intended.
7. Handle `IN` lists by generating the right number of placeholders, not by joining values into the text.
8. Check ORM raw helpers. Tagged template helpers that parameterise are safe. Their string-taking `unsafe` variants are not.
9. Check NoSQL and other query languages: filters built from parsed request JSON can inject operators such as `$ne`. Cast values to expected types before use.
10. Check least privilege for the database user: no schema changes, no access to other databases, limited to needed tables.
11. Write tests that send a quote, a comment marker and a tautology as input and confirm results are unchanged.
12. Report each site as fixed, safe with reason, or needs the owner.

## Gotchas

- Escaping functions are brittle and depend on character sets. Parameters keep the data out of the query text entirely.
- Stored values are untrusted too. Data saved earlier and then concatenated later is second order injection.
- ORMs are not immune: raw fragments, `order_by` with user strings and `where` with string arguments inject.
- A numeric id read from the URL is still a string until cast. Casting and parameters should both happen.
- Error messages that show the SQL help an attacker. Log them server side and return a generic error.
- Stored procedures that build dynamic SQL inside reintroduce the problem under a different name.

## Output

- A table of query sites: location, source of input, status, fix.
- The edits made and tests added.
- Sites that could not be traced, with why.
