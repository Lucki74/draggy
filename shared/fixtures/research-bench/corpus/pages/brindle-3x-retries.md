---
url: https://docs.brindle.example/3.x/retries
title: Retries in Brindle 3.x
date: 2023-02-14
keywords: brindle 3.x retries retry max_retries default backoff base factor delay seconds
---
A job that raises an error is retried. The default max_retries is 3.

The delay before retry n is base × factor^(n−1) seconds. The default base is 1 second and the default factor is 2, so the delays are 1, 2 and 4 seconds.

Set max_retries to 0 to turn retries off.
