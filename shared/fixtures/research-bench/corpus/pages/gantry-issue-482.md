---
url: https://github.example/gantry/gantry/issues/482
title: Cache eviction deletes in-use entries
date: 2026-02-18
keywords: gantry issue 482 cache eviction deletes in-use entries bug report build fails
---
A long build fails halfway because the cache evicts an entry the build is still reading. Ottilie Marchetti: reproduced, and I fixed it. The fix is in 1.8.2.
