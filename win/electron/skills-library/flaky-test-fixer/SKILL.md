---
name: flaky-test-fixer
description: Finds why a test passes on some runs and fails on others, proves the cause by repeating runs, and removes the cause instead of adding retries. Use when the user says a test is flaky, fails only on CI, or passes and fails at random.
---

# Flaky test fixer

## Goal

Turn an unreliable test into one that gives the same answer every run, by fixing the actual source of the variation. A good result states which kind of flake it was and shows many consecutive green runs.

## When to use

- A test fails now and then with no code change.
- A test passes alone but fails in the full suite, or the other way round.
- A test fails only on CI or only on one machine.
- A merge is blocked by a test the author says is unrelated.
- The same test has been rerun by hand several times to get green.
- A test uses real time, the network or the file system.

For one clear failure after a change, use `use_skill` with `test-failure-triage`. For a bug in the product code caused by timing, use `race-condition-finder`.

## Steps

1. **Collect evidence.** Get the failure messages from several failing runs (CI logs, or reruns with `run_command`). Note whether messages are identical.
2. **Measure the rate.** Run the single test many times in a loop with `run_command` (for example 30 runs) and count failures. Then run it inside its file and inside the whole suite.
3. **Classify.** Check each class against the evidence:
   - Shared state: another test leaves data, a global, a file or a timer behind.
   - Order dependence: the test passes only after another one.
   - Time: real clocks, sleeps, timeouts, time zone, midnight, DST.
   - Async: missing await, unflushed promises, event not yet fired.
   - Randomness: unseeded random data, map or set ordering.
   - Environment: ports in use, parallel workers, slow CI disk, locale.
4. **Prove it.** Force the suspected condition: run in random or reversed order, with one worker, with a fake clock, or with a slowed dependency. A good hypothesis makes the failure happen on demand.
5. **Fix the cause.** Isolate state per test, set up and tear down explicitly, wait for the condition and not for a duration, inject the clock, seed the random source. Use `edit_file`.
6. **Confirm.** Repeat the same loop as step 2 with at least as many runs, and one run of the whole suite.
7. Write down the cause class in the commit or pull request text so the next person can recognise it.

## Gotchas

- A retry wrapper or a longer sleep makes the dashboard green and leaves the flake. Use it only as a labelled stopgap.
- Fifty green runs on a fast laptop say little about a CI failure. Reproduce the CI conditions: worker count, CPU limits, order.
- The flaky test is sometimes the victim. The test that leaks state may run earlier in the file.
- Fixing the test can mask a real race in the product. Ask whether a user could hit the same timing.
- Skipping the test without a tracked reason is deletion with extra steps.

## Output

Cause class, evidence (failure rate before, the forced repro), the change made, failure rate after with run count. List any test you suspect but did not change.

Name the other tests that share the same weakness if you saw any.
