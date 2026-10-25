---
name: owasp-checklist
description: Walks a web app or API through the current OWASP Top 10 categories, turning each into concrete checks for the codebase, with a pass, fail or unknown result and evidence per item. Use when the user asks for an OWASP review, a pre-launch security checklist, or a structured audit of a web app or API.
---

# OWASP checklist

## Goal

Cover the well-known classes of web risk in a fixed order so nothing obvious is skipped.

A good pass produces evidence per category, and marks unknowns openly instead of claiming coverage.

## When to use

- A launch or customer review needs a structured security pass.
- The user wants a baseline before deeper work.
- The user mentions OWASP or the Top 10 by name.
- For a diff-based review of changes, use `use_skill` with `security-review`.

## Steps

1. Fetch the current list with `read_url` from the OWASP Top 10 project page. The list and its names change between editions, so use the live one and note its year.
2. Map the app with `explore`: framework, auth, database, front end, external services, deploy setup. Record this in a short header.
3. For each category write two or three concrete checks for this stack before looking at code.
4. Access control: pick five sensitive endpoints and verify the code checks ownership and role on each, including object ids and admin routes.
5. Cryptographic failures: look for plain HTTP, weak hashing, hardcoded keys, sensitive data in logs or URLs, and missing encryption at rest where data is sensitive.
6. Injection: search for string-built queries, shell calls and unescaped output. Hand off to `use_skill` with `sql-injection-check` or `xss-csp-review` for depth.
7. Insecure design: check for rate limits on login, reset and expensive actions, and abuse cases for business logic such as coupon or transfer flows.
8. Security misconfiguration: debug mode, default accounts, verbose errors, open storage, missing headers, directory listing.
9. Vulnerable components: run the audit tool with `run_command` and note the date. Hand off to `use_skill` with `dependency-vulnerability-triage`.
10. Authentication failures, integrity failures (unsigned updates, unsafe deserialisation, unpinned CI), logging and monitoring gaps, and SSRF: apply the matching checks.
11. Record each category as pass, fail or unknown with file references.
12. Create the report with `create_file` and list the top five fixes.

## Gotchas

- A checklist pass does not mean the app is secure. It covers common classes, not business-specific flaws.
- Category names and order differ between editions. Quoting an old list as current misleads readers.
- Skimming ten endpoints finds the pattern; skipping the unusual ones (exports, admin, imports) misses the bug.
- Marking unknown as pass is the main failure of checklists. Use the unknown state.
- Scanner output is input to the review, not the review. Verify each hit in code.
- Testing only on the happy account misses horizontal access problems. Use two normal users in tests.

## Output

- A table: category, checks done, result, evidence, fix.
- Top five fixes in order.
- The edition of the list used, with its date, and what was not covered.
