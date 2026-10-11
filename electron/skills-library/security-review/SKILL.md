---
name: security-review
description: Audits code or pending changes for security vulnerabilities (injection, broken access control, secrets, unsafe file and command handling, dependency risks) with evidence, severity and fixes. Use when the user asks for a security review, audit, or whether code is safe.
---

# Security review

Report only real, reachable issues with a concrete attack scenario. A long list of theoretical warnings hides the one that matters.

## Scope

- Changes only: git_status and git_diff (or the branch diff with run_command).
- Whole project: start from the attack surface: HTTP routes and handlers, CLI arguments, file uploads and parsing, IPC or message handlers, webhooks, authentication, database access, shell and process execution, deserialisation, templates.
Find them with search_files and explore. Read checklist.md (use_skill with file "checklist.md") for what to look for.

## For each candidate issue

1. **Source:** where untrusted data enters (request, file, environment, another service).
2. **Sink:** where it becomes dangerous (query, shell, file path, HTML output, eval, redirect, deserialiser, permission decision).
3. **Path:** trace that the data can actually reach the sink without adequate validation or encoding. Read the code in between.
4. **Impact:** what an attacker gains: data read or changed, code execution, account takeover, denial of service.

If the path is blocked (parameterised, validated, not reachable), drop it.

## Also check

- Secrets: search_files for keys, tokens, passwords and private keys committed to the repository, including config and test files.
- Dependencies: if the ecosystem has an audit command (npm audit, pip-audit, cargo audit), run it with run_command and report high-severity findings that affect code actually used.
- Security-relevant configuration: CORS, cookies (Secure, HttpOnly, SameSite), CSP, TLS verification disabled, debug mode in production.

## Report

For each finding: **severity** (Critical, High, Medium, Low), location (file:line), the vulnerability class, a concrete exploit scenario, and a specific fix with example code. Order by severity. End with what was reviewed and what was out of scope. Do not include exploit code beyond what is needed to demonstrate the issue.
