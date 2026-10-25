---
name: property-based-tests
description: Finds the invariants a function must always hold and writes generator-driven tests that search for inputs which break them, then reads the shrunk counterexamples. Use when the user asks for property-based tests, wants to fuzz a function, or asks what must always be true about some code.
---

# Property-based tests

## Goal

Replace a handful of hand-picked examples with rules that must hold for any valid input, and let a generator hunt for the input that breaks them. A good result is a small set of meaningful properties, generators that cover the edges, and any counterexample explained.

## When to use

- Pure functions with wide input ranges: parsers, encoders, sorting, formatting, math, merging.
- Code with a round trip (serialize and parse) or an inverse.
- The user suspects edge cases the examples miss.
- A bug was found by chance and the user wants to find its relatives.
- A function has many valid input shapes that examples do not cover.
- The user is changing an algorithm and wants a safety net.

For plain example tests, use `use_skill` with `write-tests`.

## Steps

1. **Find the target and the library.** Read the function with `read_file`. Check the project for a property library (fast-check, Hypothesis, proptest, QuickCheck style) with `search_files` in the manifest. If none exists, ask with `ask_user` before adding a dependency. Check current API names with `read_url` on the library docs; do not rely on memory.
2. **List properties.** Typical families:
   - Round trip: decode(encode(x)) equals x.
   - Idempotence: doing it twice equals doing it once.
   - Invariant: output length, ordering, sum or set of items is preserved.
   - Oracle: matches a slow but obviously correct version.
   - Relation: adding an item never lowers a count.
   - No crash: any input gives a result or a defined error.
3. **Build generators.** Produce valid inputs only, plus deliberate extremes: empty, one item, duplicates, huge, negative, unicode, boundary numbers. Constrain with the type's real rules, not by filtering out most draws.
4. **Write the tests** with `create_file` or `edit_file`, one property per test, named for the rule. Fix a seed or record it in the output.
5. **Run** with `run_command`. On failure read the shrunk counterexample first. Decide whether the code, the property or the generator is wrong.
6. **Pin the finding.** Turn each real counterexample into a plain example test so it stays covered.
7. Run the properties several times with different seeds to see whether anything new appears.

## Gotchas

- A property that recomputes the answer with the same logic as the code can never fail.
- Heavy filtering in a generator means most draws are discarded and the interesting region is never reached. Build values to be valid.
- Loosening a property after a failure is how real bugs get argued away. Check the counterexample against the spec first.
- Floats, time and randomness inside the function make results unstable. Inject them or avoid them in properties.
- Slow properties with many runs make the suite unusable. Keep the default count low and run more in a nightly job.

## Output

The properties in plain words, the test file path, the run result, and each counterexample found with its verdict (bug in code, in property, or in generator).

Say how long the property run takes so the user can judge whether to keep it in the main suite.
