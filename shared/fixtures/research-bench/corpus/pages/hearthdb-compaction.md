---
url: https://hearthdb.example/docs/compaction
title: Compaction in Hearthdb
date: 2026-01-15
keywords: hearthdb compaction threshold level size mib 64 trigger merge
---
Compaction merges the sorted files of one level into the next. It starts when a level grows past the compaction threshold. The default threshold is 64 MiB.

Raising the threshold means fewer but longer compactions.
