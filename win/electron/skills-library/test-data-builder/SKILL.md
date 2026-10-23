---
name: test-data-builder
description: Replaces long test setup with small builders or fixtures that create valid objects by default and let each test override only the fields it cares about. Use when the user says test setup is huge, asks for fixtures, or wants test data helpers.
---

# Test data builder

## Goal

Make each test show only the data that matters to it. A good result has builders with valid defaults, overrides by name, no shared mutable fixture, and tests that read like the rule they check.

## When to use

- Tests start with thirty lines of object literals.
- Changing a model breaks dozens of tests.
- Tests share one big fixture and affect each other.
- Adding a required field to a model broke many tests.
- Tests need many near identical objects with one difference each.
- The team wants a standard way to create objects in tests.

To set up the environment around the tests, use `use_skill` with `integration-test-setup`.

## Steps

1. **Find the pain.** Use `search_files` for repeated literals and fixture files, and `read_file` on two or three long tests. Run the suite with `run_command` to get a baseline.
2. **Identify the models.** List the objects tests build most (user, order, config, request). Read their types or schemas so defaults are valid, including required relations.
3. **Write one builder per model.** Give it a function or class that returns a valid object with plain, boring defaults, and accepts a partial override. Nested objects get their own builders. Create the file with `create_file` in the test helpers folder.
4. **Make intent visible.** Add named variants only for meaningful states (`expiredSubscription`), not for every field. Unique values (ids, emails) come from a counter, not from random numbers.
5. **For stored data**, add a helper that builds and saves, and returns the saved object. Keep creation and persistence separate so unit tests do not need a database.
6. **Migrate a few tests first** with `edit_file`: replace the literal with the builder and override only what the test asserts about. Run those tests.
7. **Check readability.** In each migrated test, the overridden fields should be exactly the ones the test name talks about.
8. **Migrate the rest** in batches, running the suite after each batch.
9. Delete the fixture files and literals that no test uses after the migration.

## Gotchas

- Defaults that are invalid force every test to patch them, which defeats the builder. Validate defaults against the real schema.
- A shared object returned by reference lets one test change the next. Build a fresh one each call.
- Random data without a printed seed makes failures impossible to repeat. Prefer counters, or log the seed.
- A builder that silently fills a field the test depends on hides the rule. Name important fields in the test.
- Builders that grow logic become a second implementation of the model. Keep them dumb.

## Output

The builder files added, the number of tests migrated with before and after line counts for one example, and the suite result. Note any model left unmigrated.

Show one migrated test as an example of the new style.
