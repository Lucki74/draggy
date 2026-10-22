---
name: security-review
description: Audits code or pending changes for security vulnerabilities (injection, broken access control, secrets, unsafe file and command handling, dependency risks) with evidence, severity and fixes. Use when the user asks for a security review, an audit, a vulnerability check, or whether code is safe.
---

# Security review

## Goal

Report only real, reachable issues, each with a concrete attack scenario. A long list of theoretical warnings hides the one that matters.

## When to use

- The user asks for a security review or audit, or whether code is safe.
- For a general review of correctness and maintainability, use `use_skill` with `code-review`.

## Steps

1. Set the scope.
   - Changes only: run `git_status` and `git_diff`, or the branch diff with `run_command`.
   - Whole project: start from the attack surface. That means HTTP routes and handlers, CLI arguments, file uploads and parsing, IPC or message handlers, webhooks, authentication, database access, shell and process execution, deserialisation and templates. Find them with `search_files` and `explore`.
2. Read the [checklist](checklist.md) with `use_skill` and file "checklist.md" for what to look for.
3. For each candidate issue, establish four things:
   - Source: where untrusted data enters (request, file, environment, another service).
   - Sink: where it becomes dangerous (query, shell, file path, HTML output, eval, redirect, deserialiser, permission decision).
   - Path: that the data can reach the sink without adequate validation or encoding. Read the code in between.
   - Impact: what an attacker gains, such as data read or changed, code execution, account takeover or denial of service.
4. Drop the candidate if the path is blocked (parameterised, validated, not reachable).
5. Search for secrets with `search_files`: keys, tokens, passwords and private keys in the repository, including config and test files.
6. If the ecosystem has an audit command (npm audit, pip-audit, cargo audit), run it with `run_command` and report high-severity findings that affect code actually used.
7. Check security-relevant configuration: CORS, cookies (Secure, HttpOnly, SameSite), CSP, disabled TLS verification, debug mode in production.

## Gotchas

- A finding without a traced source-to-sink path is a guess. Verify before reporting.
- A diff shows only changed lines. The vulnerable sink or the missing check may sit in unchanged code.
- Dependency audit hits often concern code the project never calls. Report only the ones in a used path.
- Exploit code beyond what demonstrates the issue helps no one. Keep it minimal.
- A review that does not say what it skipped sounds more complete than it is.

## Output

For each finding: severity (Critical, High, Medium, Low), location (file:line), the vulnerability class, a concrete exploit scenario, and a specific fix with example code. Order by severity. End with what was reviewed and what was out of scope.
