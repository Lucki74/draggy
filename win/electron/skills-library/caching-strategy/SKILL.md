---
name: caching-strategy
description: Decides what to cache, at which layer, with which keys, lifetimes and invalidation, and implements it without serving wrong or private data. Use when the user asks to add caching, whether something should be cached, or says the cache returns stale data.
---

# Caching strategy

## Goal

Cut latency or load for data that is expensive to produce and tolerant of staleness, while keeping correctness. A good result names the layer, key, lifetime and invalidation for each cached item, and measures the gain.

## When to use

- A query, computation or external call is slow or called very often.
- The cache serves stale or wrong data, or hits are lower than expected.
- For fixing a slow query itself, use `use_skill` with `query-plan-reader` first.
- For the HTTP side of caching in frontends, use `use_skill` with `web-performance-budget`.

## Steps

1. Measure first. Find the slow or hot path with logs or timings via `run_command`, and confirm the cost is in the operation you plan to cache. Many slow endpoints are fixed by an index or by removing repeated queries instead.
2. List candidates and for each ask how often it is read, how often it changes, how stale it may be and what a wrong value costs. Read-heavy, rarely changing, low-risk data is the target.
3. Choose the layer: in-process memory (fast, per instance, lost on restart), shared store such as Redis (consistent across instances), HTTP and CDN caching (best for public content), or a precomputed table.
4. Design the key. Include everything that changes the result: resource id, user or tenant if the data is personalized, locale, query parameters, version. Never share a key across users for private data.
5. Set lifetime and invalidation. Pick a time to live as a safety net, and add explicit invalidation on writes (delete or update the key in the same code path as the change) for data that must be fresh.
6. Prevent stampedes. When a hot key expires, many requests recompute together. Use a lock or single-flight, early refresh, or jittered lifetimes.
7. Cache failures and misses deliberately: store a short-lived negative entry for not-found if repeated misses hurt, and never cache errors by accident.
8. Decide behaviour when the cache is down: fall back to the source and protect it from the sudden load.
9. Implement with `edit_file`, add metrics for hits and misses, and test stale, invalidated and cold cases with `run_command`.

## Gotchas

- "There are only two hard things" applies: without an invalidation plan the cache serves old data until the lifetime runs out. Write the plan before the code.
- Caching a personalized response under a shared key leaks one user's data to another. This is a security bug, not a performance bug.
- A cache can hide a slow query and make it a time bomb when the cache is cleared. Keep the source path healthy.
- Large objects serialized on every hit can cost more than the original query. Measure the end to end time.
- Layered caches multiply staleness: a CDN lifetime on top of an application lifetime on top of a browser lifetime.
- Cache keys built from unbounded user input let attackers fill memory. Bound or hash the input and cap the size.

## Output

- A table of cached items: layer, key, lifetime, invalidation trigger, expected staleness.
- The code changes and the hit-rate and latency before and after.
- Risks remaining, including what happens on a cold start or cache outage.
