---
name: type-errors
description: Fixes type errors and strengthens typing in TypeScript, Python (mypy, pyright) and similar, by finding the real mismatch rather than silencing it with any, casts or ignore comments. Use when the type checker fails, the user asks to add types, or wants to remove any and unsafe casts.
---

# Type errors

## Goal

Get the type checker to pass by correcting the actual mismatch, so the types describe what the code does. No suppressions unless they are unavoidable and explained.

## When to use

- `tsc`, mypy, pyright, `cargo check` or similar reports errors.
- The user asks to add types to untyped code.
- The user wants `any`, `as unknown as` or ignore comments removed.
- For a runtime failure rather than a type failure, use `use_skill` with `debugging`.

## Steps

1. Run the checker with `run_command`, using the project's own command: `npx tsc --noEmit` or the typecheck script, `mypy`, `pyright`, `cargo check`, `go vet`. Read the configuration (tsconfig.json strictness flags, mypy.ini) so fixes fit the project's settings.
2. Take errors one file at a time, starting with the first in each file, since later ones often cascade.
3. Read the full message: the expected type, the actual type, and where each comes from.
4. Decide which side is wrong: the value, the declared type, or a function's signature. Fix the side that is actually wrong.
5. Apply the usual real fixes:
   - Handle null or undefined explicitly (a guard, a default, an early return) instead of `!`.
   - Narrow unions with checks (`typeof`, `in`, discriminant fields) instead of casts.
   - Correct a function signature or generic parameter so callers get the right type.
   - Type external data at the boundary with a validation step (zod, pydantic, a type guard) rather than asserting it.
   - Update outdated type definitions or @types packages when the library changed.
6. Avoid `any`, `as unknown as`, `@ts-ignore`, `# type: ignore` and `cast()`. If one is truly necessary (a broken third-party type), use the narrowest form (`@ts-expect-error` with a reason) and say why.
7. When adding types to untyped code, start at the edges (public functions, data models, API responses) and work inwards. Prefer inferred types for locals. Use precise types (literal unions, readonly, branded IDs) where they prevent real mistakes, not everywhere.
8. Re-run the type checker until clean, then run the tests with `run_command`, since type fixes can change runtime behaviour when they add guards.

## Gotchas

- Fixing the last error first wastes effort, because upstream errors cascade into it.
- A cast or `any` makes the error vanish and moves the bug to runtime.
- Asserting the shape of API or file data proves nothing. Validate it at the boundary.
- A new guard can change runtime behaviour, so a clean type check is not the end. Run the tests.
- Loosening tsconfig strictness to get a pass is not a fix.

## Output

How many errors were fixed, the notable root causes, any suppressions left with reasons, and behaviour changes introduced by new guards.
