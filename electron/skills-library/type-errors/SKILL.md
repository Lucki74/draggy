---
name: type-errors
description: Fixes type errors and strengthens typing in TypeScript, Python (mypy, pyright) and similar, by finding the real mismatch rather than silencing it with any, casts or ignore comments. Use when the type checker fails, the user asks to add types, or to remove any and unsafe casts.
---

# Type errors

## Run the checker

Use the project's own command with run_command: `npx tsc --noEmit` or the typecheck script, `mypy`, `pyright`, `cargo check`, `go vet`. Read the configuration (tsconfig.json strictness flags, mypy.ini) so fixes fit the project's settings.

## Fix properly

For each error, starting with the first in each file (later ones often cascade):
1. Read the full message: the expected type, the actual type, and where each comes from.
2. Decide which side is wrong: the value, the declared type, or a function's signature. Fix the side that is actually wrong.
3. Typical real fixes:
   - Handle null or undefined explicitly (a guard, a default, an early return) instead of `!`.
   - Narrow unions with checks (`typeof`, `in`, discriminant fields) instead of casts.
   - Correct a function signature or generic parameter so callers get the right type.
   - Type external data at the boundary with a validation step (zod, pydantic, a type guard), rather than asserting it.
   - Update outdated type definitions or @types packages when the library changed.
4. Avoid `any`, `as unknown as`, `@ts-ignore`, `# type: ignore` and `cast()`. If one is truly necessary (a broken third-party type), use the narrowest form (`@ts-expect-error` with a reason) and say why.

## Adding types to untyped code

Start at the edges (public functions, data models, API responses) and work inwards. Prefer inferred types for locals. Use precise types (literal unions, readonly, branded IDs) where they prevent real mistakes, not everywhere.

## Verify

Re-run the type checker until clean, then run the tests, since type fixes can change runtime behaviour when they add guards.

## Report

How many errors were fixed, the notable root causes, any suppressions left with reasons, and behaviour changes introduced by new guards.
