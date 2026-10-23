---
name: env-config-management
description: Audits and organises application configuration across environments: a single typed config module, validated at startup, an example env file, and secrets kept out of the repo and images. Use when the user asks to clean up env vars, manage config per environment, or debug works-locally-breaks-in-prod differences.
---

# Environment config management

## Goal

Make configuration explicit, validated and different only where it should be.

A good result fails fast at startup with a clear message when a value is missing, and no secret value lands in git, logs or an image.

## When to use

- Env vars are read in scattered places with silent defaults.
- Staging and production behave differently for unknown reasons.
- A secret was committed or might have been.
- For rotating a leaked key, use `use_skill` with `api-key-rotation`.

## Steps

1. Inventory reads with `search_files` for `process.env`, `os.environ`, `getenv` and `import.meta.env`. Build a table of name, file, default and purpose.
2. Inspect committed files: `.env*`, config files, CI workflows and Dockerfiles. Check `.gitignore` covers real env files with `read_file`.
3. Scan history for committed secrets with `run_command` such as `git log -p -S` on suspicious names. If a real secret appears, stop and flag rotation.
4. Group values: public config, per-environment config, secrets. Only the last group needs a secret store.
5. Create one config module with `create_file` that reads, parses types and validates everything at startup, and have the rest of the code import from it. Replace scattered reads with `edit_file`.
6. Remove dangerous defaults, such as a fallback secret or `debug=true`, so missing production values stop the app.
7. Write `.env.example` with every name, a placeholder and a comment, and no real values.
8. Decide where each environment gets values: CI variables, platform settings, or a secret manager. Check the platform docs with `read_url` for injection details.
9. Compare environments by name only (keys, not values) to find ones set in one place and missing in another.
10. Ensure client side bundles contain only values meant to be public; check the build prefix rules for the framework.
11. Make logs print config keys but never values at startup.
12. Document how to add a new variable in four steps.

## Gotchas

- Prefixed variables such as `NEXT_PUBLIC_` or `VITE_` are embedded in browser bundles. A secret named that way is public.
- Env values are always strings. `"false"` is truthy, and a port arrives as text.
- A fallback like `process.env.KEY || "dev-secret"` ships to production when the variable is forgotten.
- Build time and runtime variables differ in many platforms. A value set only at runtime is absent from a static build.
- Removing a secret from the latest commit leaves it in history. It is leaked until rotated.
- Docker `ENV` and `ARG` values stay in image layers and can be read with the image.

## Output

- The variable inventory table with category and environments needing it.
- Files created or edited and a validated startup behaviour.
- Any secret exposure found, flagged first.
