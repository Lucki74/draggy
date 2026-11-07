---
url: https://hearthdb.example/2.1/docs/compaction
title: Compaction in Hearthdb 2.1
date: 2023-07-09
keywords: hearthdb 2.1 compaction threshold level size mib 32 trigger merge
---
Compaction merges the sorted files of one level into the next. It starts when a level grows past the compaction threshold. The default threshold is 32 MiB.
