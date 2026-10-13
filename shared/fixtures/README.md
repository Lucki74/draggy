# Golden fixtures

These files pin behavior that the Electron app (TypeScript) and the Rust core must share. Each area is a folder, each file a list of cases:

```json
{
  "area": "toolParsing",
  "description": "One line on what the file covers",
  "cases": [
    { "name": "short readable name", "input": {}, "expected": {} }
  ]
}
```

The TypeScript runner lives in `src/__tests__/fixtures/<area>.test.ts` and calls the existing implementation. The Rust runner lives in `core/crates/<crate>/tests/fixtures.rs` and uses `draggy-testkit` to read the same files. A fixture change has to pass in both, which catches drift while both implementations exist.

Rules for writing a case:

- Generate `expected` by running the TypeScript code, then read it before committing. A wrong value pinned here is wrong in both places.
- Use plain JSON: no `undefined`, `NaN` or dates. Represent absence as `null`. An input that has to be NaN or infinite is written as the string "NaN", "Infinity" or "-Infinity", and both runners turn it back (see `models/vram.json`).
- Keep cases small and named for the behavior, so a failure tells you what broke.
- Anything secret-shaped is fake. Keys, tokens and OAuth codes never appear here, not even hashed.
