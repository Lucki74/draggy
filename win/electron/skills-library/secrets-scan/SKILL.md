---
name: secrets-scan
description: Scans the working tree and git history for hardcoded secrets such as API keys, tokens, private keys and connection strings, classifies each hit, and sets up scanning to stop new leaks. Use when the user asks whether secrets were committed, wants a repo scan before going public, or needs a pre-commit secret check.
---

# Secrets scan

## Goal

Find real credentials that are exposed, and make sure the next one is caught before it lands.

A good result separates live secrets from placeholders and states clearly which ones must be rotated.

## When to use

- A repository is about to be made public or shared.
- The user suspects a key was pushed.
- The team wants automated secret detection.
- For the rotation steps after a leak, use `use_skill` with `api-key-rotation`.

## Steps

1. Check for an installed scanner with `run_command`, such as `gitleaks version` or `trufflehog --version`. If one exists, run it on the working tree and on history.
2. Without a scanner, search the tree with `search_files` using patterns: `BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY`, `AKIA[0-9A-Z]{16}`, `xox[baprs]-`, `ghp_`, `sk_live_`, `password\s*=`, `://[^/\s:]+:[^@\s]+@`.
3. List config-like files with `list_directory`: `.env*`, `*.pem`, `*.key`, `credentials.json`, `terraform.tfvars`, `*.p12`, and check each is ignored by `.gitignore`.
4. Search history for removed files and values: `git log --all --diff-filter=D --name-only` and `git log -p -S"<pattern>"` through `run_command`.
5. Classify every hit: live secret, example or placeholder, test fixture, public identifier (a publishable key is not secret). Check the key prefix meaning in the provider docs with `read_url` when unsure.
6. For live secrets, do not print the full value in your answer. Show the file, line and the first four characters.
7. Tell the user to rotate every live secret now. Removing it from the code does not undo exposure, because history, forks and caches keep it.
8. Replace the literals with environment variable reads using `edit_file`, and add the names to `.env.example` with placeholders.
9. Add `.gitignore` entries for secret files.
10. Add prevention: a pre-commit hook or CI step with the chosen scanner, and a baseline file for known false positives. Create the config with `create_file`.
11. If history rewrite is wanted, explain the cost (all clones need resync) and that rotation still comes first.
12. Rerun the scan and confirm the live findings are gone.

## Gotchas

- Rewriting git history without rotating the key leaves the secret valid. It may already be copied by bots that watch public pushes.
- High entropy strings include hashes, ids and build outputs. Expect false positives and review each.
- Secrets also hide in Docker images, CI logs, issue comments, notebooks and compiled front-end bundles.
- A `.env` added to `.gitignore` after being committed is still tracked. Run `git rm --cached` for it.
- Base64 encoding hides nothing from a scanner that decodes, and nothing from an attacker.
- Never paste found secrets into chat, tickets or search engines when testing whether they work.

## Output

- Findings table: file, line, type, status (live, placeholder, fixture), action.
- Which secrets must be rotated, listed first.
- Prevention added and the clean rescan result.
