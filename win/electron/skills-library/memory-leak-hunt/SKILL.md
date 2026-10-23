---
name: memory-leak-hunt
description: Confirms a memory leak with repeated measurements, finds the reference that keeps objects alive, and fixes it at the owner. Use when the user says memory keeps growing, the app leaks, or a process runs out of memory after running a while.
---

# Memory leak hunt

## Goal

Decide whether memory growth is a real leak, find what retains the objects, and fix it. A good result has numbers before and after over the same repeated workload, and a named retaining reference.

## When to use

- Memory in a long-running process rises and does not come back.
- A page or window gets slower after many navigations.
- An out-of-memory crash appears only after hours.
- A server needs a restart every few days.
- Switching between views makes a desktop app heavier.
- A script that processes many files grows until it is killed.

For slow code without growth, use `use_skill` with `performance`.

## Steps

1. **Define the workload.** Pick one action that should return to the same state: open and close a view, handle a request, run a job. Ask with `ask_user` if it is unclear.
2. **Measure a baseline.** Record memory after startup and a forced collection when the runtime allows it. For Node use `run_code` or a script via `run_command` that prints heap usage; for a browser page use `browser_console` to read the memory estimate if the page exposes it. Check the runtime docs with `read_url` for the right flag or API.
3. **Repeat and compare.** Run the action 20 to 50 times, force a collection, measure again. Do it three rounds. Steady growth per round is a leak; one jump and then a plateau is a cache or warm-up.
4. **Narrow the area.** Disable parts of the workload one at a time, with measurements each time, until growth stops.
5. **Find the retainer.** Take two heap snapshots, before and after the loop, and compare object counts by class. Follow one leaked object to its path from a root. Use `search_files` for the suspect type in the source.
6. **Look for the usual owners:** event listeners never removed, timers and intervals, subscriptions, module level caches or maps without a limit, closures holding big objects, detached DOM nodes, unclosed handles, growing queues or logs in memory.
7. **Fix at the owner.** Remove the listener on teardown, clear the timer, bound the cache, or drop the reference. Use `edit_file`.
8. **Re-measure** with the same workload and the same number of rounds. Growth per round should be flat.
9. Remove any measurement code you added once the fix is confirmed.

## Gotchas

- Memory that is freed lazily looks like a leak until a collection runs. Force one before each reading.
- A cache that grows to a limit and stops is not a leak. A cache with no limit is one.
- The allocation site is not the culprit. The reference that keeps the object alive is.
- Dev tools, hot reload and debug builds hold extra memory. Measure a build close to production.
- One run proves little. Compare rounds, not single readings.

## Output

The workload, a small table of memory per round before and after, the retaining reference with file and line, the fix, and any remaining growth you did not explain.

Give the user the commands used so they can repeat the measurement later.
