---
name: cost-audit
description: Audits cloud spend from billing exports, infrastructure code and resource inventories, finds idle, oversized and forgotten resources, and ranks savings by amount, effort and risk without guessing prices. Use when the user says the cloud bill is too high, asks where money goes, or wants cost reduction ideas.
---

# Cloud cost audit

## Goal

Show where the money goes and list the changes that cut it, each with a size, an effort and a risk.

A good audit uses the user's real numbers and checks live price pages, never remembered prices.

## When to use

- A monthly bill rose or is higher than expected.
- The user wants a cost review before a budget meeting.
- Infrastructure code exists and may be oversized.
- For image size, not cloud spend, use `use_skill` with `container-size-diet`.

## Steps

1. Ask with `ask_user` for the billing export or a cost explorer view grouped by service, and the period. Do not ask for credentials; ask for a file or pasted table.
2. Read the data with `read_file` or process a CSV with `run_command`. Group by service, account, region and tag. Show the top five lines and their share.
3. Compare this period to the last to find what grew, and match jumps to dates of deploys or launches.
4. Scan infrastructure code with `search_files` for instance types, storage sizes, replica counts and NAT or load balancers per environment.
5. Look for the usual leaks: idle instances, unattached disks and IPs, old snapshots, oversized databases, dev environments running nights and weekends, logs with no retention, cross-region and egress traffic.
6. Check that non-production sizes are smaller than production and that autoscaling has a sensible floor.
7. Look at commitment options only after usage is stable. Fetch current pricing and terms with `read_url` on the provider page; never quote prices from memory.
8. For each idea give estimated saving using the user's figures, effort, and risk (could it break something or lose data).
9. Rank by saving divided by effort, and mark ones needing a performance test first.
10. If the user allows read only CLI access, use `run_command` for list commands such as describing unattached volumes. Never delete or resize anything without explicit approval.
11. Add tagging advice so next month's report can be split by team.
12. Summarise with a table and an owner suggestion per item.

## Gotchas

- Deleting a snapshot, disk or bucket that looks unused can destroy the only copy. Confirm ownership and backups first.
- Rightsizing from average CPU ignores memory and peak load. Check peaks over a full business cycle.
- Data transfer and managed service request charges hide below the compute lines and often make the surprise.
- A reserved or committed plan on a service about to be migrated locks in waste.
- Savings estimates are a range, not a promise, because usage changes. Say so.
- Credits and discounts distort month to month comparison. Compare net and gross.

## Output

- Top spend breakdown, then a ranked savings table: item, estimate, effort, risk, owner.
- Quick wins separated from projects.
- Assumptions, and the price pages checked with the date.
