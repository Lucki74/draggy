# Review checklist

## Correctness
- [ ] Conditions: inverted logic, && vs ||, <= vs <, missing else branch
- [ ] Empty, null, undefined, zero, negative and very large inputs
- [ ] Error paths: exceptions caught, errors surfaced, resources released (finally, defer, using)
- [ ] Async: awaits present, promise rejections handled, no fire-and-forget that loses errors
- [ ] Concurrency: shared state, check-then-act races, reentrancy
- [ ] Dates and times: time zones, DST, month boundaries, parsing locale
- [ ] Strings: unicode, case sensitivity, trimming, encoding
- [ ] Collections: mutation while iterating, stable ordering assumptions, duplicates
- [ ] Numbers: integer overflow, float rounding for money, division by zero

## State and data
- [ ] State updates are atomic and consistent on failure halfway
- [ ] Cache invalidation when underlying data changes
- [ ] Database migrations reversible or safe on existing data
- [ ] No silent data loss on overwrite, delete or truncate

## Security
- [ ] Untrusted input validated at the boundary
- [ ] Queries parameterised, shell commands not built from strings
- [ ] Authorisation checked on every entry point, not just the UI
- [ ] Secrets not logged, committed or sent to the client
- [ ] Paths from input cannot escape the intended directory

## API and compatibility
- [ ] Public signatures and outputs unchanged, or change is intended and documented
- [ ] Config and feature flags have safe defaults

## Tests
- [ ] New behaviour covered, including the edge cases above
- [ ] Tests would fail without the change
- [ ] No flaky timing, network or ordering dependencies

## Maintainability
- [ ] Reuses existing helpers instead of duplicating
- [ ] Names match what things do
- [ ] Comments explain why, and are still true
