---
name: config-and-secrets-loading
description: Structures how an application loads configuration and secrets, validating them once at startup, keeping secrets out of code and logs, and separating environments. Use when the user asks how to handle environment variables, has secrets in a repo, or wants config validated at startup.
---

# Config and secrets loading

## Goal

The app reads all configuration in one place, fails immediately with a clear message when something is missing or malformed, and never has a working default for a secret. A good result has a typed config object, an example file and no secrets in version control.

## When to use

- Environment variables are read all over the code with ad hoc defaults.
- A secret was committed, or the user fears it might be.
- A new environment (staging, production) needs setting up.
- For a release security pass, use `use_skill` with `security-review`.

## Steps

1. Inventory current usage. Use `search_files` for environment access (`process.env`, `os.environ`, `getenv`), config files and `.env` files. List each setting, its type, whether it is secret and where it is read.
2. Check for leaked secrets. Search the code and the git history through `run_command` for key-like strings, tokens and passwords in committed files and in `.env` files that were tracked. Do not print secret values in your report.
3. Create one config module that reads every setting once at startup, parses it to the right type (numbers, booleans, durations, lists) and validates it with the project's schema library or hand-written checks.
4. Fail fast and clearly. On a missing or invalid required setting, stop startup and name the variable and the expected format, never the secret value.
5. Remove defaults for secrets and for anything environment-specific that could make production quietly run with development values. Defaults are fine for harmless settings such as a port or log level.
6. Replace direct environment reads in the code with the config object using `edit_file`. Pass config in, so tests can supply their own.
7. Add an example file listing every variable with placeholders and short comments, and make sure the real `.env` is in the ignore file. Create it with `create_file`.
8. Plan secret storage for deployed environments: the platform's secret manager or injected environment, with separate values per environment and a rotation path. If a secret was exposed, treat it as compromised and tell the user to rotate it.
9. Keep secrets out of logs, error messages and client bundles. Check that config objects print with secrets redacted, and that frontend builds only include variables meant to be public.

## Gotchas

- A fallback like `process.env.JWT_SECRET || "dev-secret"` ships to production the day someone forgets to set the variable. Required secrets must have no default.
- Removing a committed secret from the latest commit does not remove it from history. The only safe fix is rotating it.
- Reading config lazily at first use moves a startup error to the middle of a request hours later.
- Boolean strings are a trap: the string `"false"` is truthy in many languages. Parse explicitly.
- Public frontend variables (those inlined into the bundle) are visible to every visitor. Never put a secret there.
- Logging the whole config object at startup is convenient and leaks every secret. Redact by field.

## Output

- The setting table: name, type, required, secret, default.
- The new config module and the files changed.
- A list of secrets that need rotating, with no values shown.
