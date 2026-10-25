---
name: side-income-tracker
description: Sets up a record of side income and related costs by period, with a clear split from personal money. Use when the user asks to track side hustle or freelance earnings, record income from a second job, or separate side income from personal finances.
---

# Side income tracker

## Goal

Give the user a simple, dated record of what comes in from side work and what it costs, kept apart from personal money. The record supports their own planning and any later conversation with a professional. The skill gives no tax advice; rules differ by place and change, so the user should check the current rules with the tax authority or a qualified professional.

## When to use

- The user earns money from freelance, selling or gig work next to a main job.
- Records are scattered across messages, apps and bank lines.
- A business with staff and bookkeeping needs `use_skill` with `month-end-checklist`.

## Steps

1. Ask with `ask_user` what kinds of side income exist, how they are paid (transfer, platform payout, cash), and how often. Ask whether a separate account is used.
2. Define the columns: date received, source, gross amount, fees withheld, net amount, invoice or reference, and notes. Add a column for the date the work was done when it differs.
3. Define the cost columns: date, description, amount, whether it relates to the side work, and where the receipt is stored.
4. Create the file with `create_file` as a CSV or Markdown table with two marked example rows. If the user has data in a file, load it with `read_file` and map it into the layout.
5. Write the rule for recording: on the day money arrives, amounts as shown on the payout or statement, and one currency per sheet.
6. Write a monthly routine: match income lines to the bank or platform statement, check for missing payouts, total income and costs.
7. Add a split rule for mixed spending, such as a phone plan, and have the user decide the share. Record the reason for the share.
8. Add a yearly summary with `run_code` formulas or a short script: gross, fees, net, costs by type.
9. Put a note on top: this is a record; the user should check the current local rules on reporting income and which costs count, using official pages (via `search_web` and `read_url` if they ask) and a professional.
10. Offer a quarterly check: compare the sheet with statements and note differences.
11. Explain how to keep invoices or payout reports in one folder with the same date naming.

## Gotchas

- Mixing personal and side spending, which makes both records unreliable.
- Recording income only when it is spent, or only the net amount after fees.
- Throwing away receipts because the bank line exists. Keep both.
- Assuming that any cost related to the work counts for reporting. Do not claim it; ask a professional.
- Forgetting payouts held back by a platform until a later date.
- Switching currency between rows without a conversion note.
- Treating gifts and reimbursements as income, or the reverse, without a note.
- Not recording small cash jobs because they feel minor.

## Output

The tracker file, the routine and the yearly summary method. Do not state any tax result or rate.

Add a prompt asking the user when they last verified the rules with an official source.
