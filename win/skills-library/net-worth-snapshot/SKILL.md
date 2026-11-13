---
name: net-worth-snapshot
description: Builds a dated snapshot of assets and debts from the user's balances and computes net worth, noting how each value was found. Use when the user asks to calculate net worth, list assets and debts, or wants a picture of where they stand.
---

# Net worth snapshot

## Goal

Produce one honest page: what the user owns, what they owe, and the difference on a single date. It is a record of figures the user provides, not an assessment of how they are doing and not advice. The user should consult a licensed advisor for decisions about investing or planning.

## When to use

- The user wants a starting point before setting goals.
- The user wants to repeat a snapshot each quarter or each year.
- Looking at where money goes is `use_skill` with `spending-analysis`.

## Steps

1. Ask with `ask_user` for the snapshot date and the currency. Use one date for every value.
2. Collect assets in groups: cash and bank accounts, savings, retirement and investment accounts (balances only), property, vehicles, other valuables, money owed to the user. Read statements with `read_file` if the user attaches them.
3. Collect liabilities: credit cards, loans, mortgage, other debts, bills due. Record balance and rate.
4. For each value note the source: statement date, an estimate, or a listing price. Mark estimates.
5. For property and vehicles, ask how the user estimates the value and suggest a conservative figure. Use `search_web` for comparable sales only if the user wants it, and cite the dates.
6. Compute totals and net worth with `run_command`. Also show liquid assets, which are cash and savings, apart from the rest.
7. If an earlier snapshot exists, show the change per group and say what moved it, such as repaid debt or a revalued asset.
8. Show the share of net worth held in property, in accounts and in cash, as plain facts.
9. Save with `create_file` as a table the user can copy forward next time.
10. Offer a repeat date, such as the first of each quarter, and a column for each date.
11. Keep a separate list of items excluded, such as small personal property, and the reason.

## Gotchas

- Valuing items at the price paid. Use current estimates and label them.
- Mixing dates between accounts, which makes the total meaningless.
- Counting a pension the user cannot yet access as cash.
- Leaving out small debts or money owed to friends.
- Treating an estimate as a fact when the change from the last snapshot is mostly a guess.
- Reading the number as a score. It moves with markets and prices.
- Counting a partner's assets as the user's own unless they are joint.
- Using an old statement for one account and a new one for another.

## Output

An assets table, a liabilities table, net worth, liquid assets, the change since the last snapshot and notes on estimated values. No advice and no forecast.

Add a line stating the date and currency at the top.
