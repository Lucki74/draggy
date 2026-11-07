---
url: https://blog.brindle.example/why-we-changed-retries
title: Why we changed the retry defaults
date: 2025-04-15
keywords: brindle blog retries defaults changed 4.0 flaky network jobs backoff
---
With 4.0 the Brindle defaults are more patient. Many jobs fail because a service is briefly down, and three quick retries gave up too soon.

So max_retries is now higher and the delays grow faster. If you liked the old behaviour, pin the old values in your settings file.
