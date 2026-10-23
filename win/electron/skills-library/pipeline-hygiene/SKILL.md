---
name: pipeline-hygiene
description: Scans an exported sales pipeline for stale, stuck, incomplete or mis-staged deals and lists the fix each one needs. Use when the user asks to clean up a pipeline, find stale deals, or audit a CRM export before a forecast.
---

# Pipeline hygiene

## Goal

Make the pipeline trustworthy by flagging records that distort it. The result is a short list of deals with the problem and the proposed fix, which the owner must confirm.

## When to use

- A forecast is coming and the pipeline looks inflated.
- The user has a CSV or spreadsheet export from a CRM.
- Deep review of one deal is `use_skill` with `deal-review`.

## Steps

1. Load the export with `read_file`. Run `run_code` to print the column names, row count and the number of blanks per column.
2. Ask with `ask_user` for the normal length of each stage, the definition of each stage, and the rule for a stale deal. Do not assume them.
3. Compute with `run_code`: days in current stage, days since last activity, and days to close date.
4. Flag these groups: close date in the past, no activity beyond the stale rule, stuck beyond the normal stage length, missing amount or owner or next step, duplicate accounts, and stage that conflicts with notes.
5. For each flagged deal write one proposed action: update the date, close as lost with a reason, merge, ask the owner, or fill the field.
6. Count flags by owner and by type, so the user sees where the problem sits.
7. Sample five flagged rows and check them against the raw data to confirm the logic.
8. Never change amounts or stages yourself. List the changes for the owners.
9. Group the fix list by owner so each person gets one short message with their deals.
10. Record the rules used (stale days, stage lengths) so the next audit uses the same ones.

## Gotchas

- Deleting old deals. Close them as lost with a reason so win-rate reports stay honest.
- Judging staleness with one threshold. A long enterprise stage is normal.
- Reading blank as zero. A missing amount is unknown.
- Date formats that differ between regions, which turn day and month around. Check with a sample.
- Counting duplicates by name only. Two accounts can share a name legitimately.
- Treating the export as live. It is a snapshot, so say its date.
- Reporting findings as errors by the owner. Often the process is unclear, not the person.
- Skipping closed-lost deals with no reason recorded, which weakens later win-loss work.

## Output

A summary of counts by problem and owner, then a table of flagged deals with the issue and proposed fix. Offer the table as a CSV through `create_file` if the user wants it.

End with the three fixes that would most improve forecast accuracy.
