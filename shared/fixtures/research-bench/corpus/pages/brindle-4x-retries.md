---
url: https://docs.brindle.example/4.x/retries
title: Retries in Brindle 4.x
date: 2025-04-22
keywords: brindle 4.x retries retry max_retries default backoff base factor delay seconds
---
A job that raises an error is retried. The default max_retries is 5.

The delay before retry n is base × factor^(n−1) seconds. The default base is 2 seconds and the default factor is 3, so the delays are 2, 6, 18, 54 and 162 seconds.

Set max_retries to 0 to turn retries off.
