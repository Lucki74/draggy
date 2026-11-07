---
url: https://docs.brindle.example/changelog
title: Brindle changelog
date: 2026-05-03
keywords: brindle changelog release notes 4.0.0 4.3.0 4.5.0 4.6.0 max_retries dead-letter queue concurrency backoff
---
## 4.6.0 (2026-04-30)

Python 3.14 support.

## 4.5.0 (2026-02-11)

The default worker concurrency went from 8 to 16.

## 4.3.0 (2025-10-01)

Added dead-letter queues. A job that fails all its retries can now be moved to a queue instead of being dropped.

## 4.0.0 (2025-04-15)

- The default max_retries went from 3 to 5.
- The default backoff base went from 1 to 2 seconds and the factor from 2 to 3.
- Dropped Python 3.9.
