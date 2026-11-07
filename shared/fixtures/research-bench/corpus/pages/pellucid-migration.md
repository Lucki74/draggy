---
url: https://pellucid.example/docs/migrate-6-to-7
title: Migrating from Pellucid 6 to 7
date: 2025-11-20
keywords: pellucid migration 6 to 7 d3 dependency dropped legacyAxis removed upgrade
---
Pellucid 7 no longer depends on d3, which is why the bundle became much smaller. Remove d3 from your peer list if only Pellucid used it.

Chart.legacyAxis is removed. Use the axes option instead.
