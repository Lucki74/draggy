---
name: financial-statement-reader
description: Walks through a supplied balance sheet, income statement or cash flow statement in plain words and points out ratios and oddities worth asking about. Use when the user asks to explain financials, read a balance sheet, or understand what a set of statements says.
---

# Financial statement reader

## Goal

Help the user understand statements they already have: what each line means, how the pieces connect, and which questions to ask the preparer. This is explanation, not advice. It does not value a company or say whether to buy, lend or invest, and the user should consult a licensed advisor or accountant for decisions.

## When to use

- The user pastes or attaches statements and wants them explained.
- The user wants ratios computed from the numbers shown.
- Judging a supplier's quote is `use_skill` with `vendor-comparison`.

## Steps

1. Read the file with `read_file`. Identify the statement type, entity, period end, currency, units (units, thousands, millions) and whether it is audited, reviewed or unaudited.
2. Ask with `ask_user` for the accounting basis if the document does not state it.
3. Check the arithmetic with `run_command`: assets equal liabilities plus equity, subtotals add up, net income links across statements.
4. Explain each major section in two or three plain sentences, using the statement's own line names.
5. Compute a few ratios only where the inputs exist: current ratio, gross margin, operating margin, debt to equity, days of receivables. Show the formula next to each.
6. Compare with the prior period if one is present. Report changes in amount and percent, and the lines that moved most.
7. List oddities: large other items, notes mentioned but missing, receivables growing faster than sales, negative equity, changes in policy.
8. Write the questions the user could send to the preparer.
9. State what cannot be concluded from these statements alone.
10. Offer a glossary of the unfamiliar line names in the document.
11. Ask the user which decision they are trying to inform, and note which numbers bear on it.

## Gotchas

- Mixing thousands and millions between statements.
- Judging a ratio without industry and size context. Say what it measures, not whether it is good.
- Comparing periods of different length, such as a full year with nine months.
- Treating unaudited numbers as verified.
- Reading the income statement alone. Cash and debt sit in the other two.
- Ignoring the notes, where leases, contingencies and policies are explained.
- Taking management commentary as fact. It is the preparer's view.
- Skipping the cash flow statement, which shows whether profit turns into cash.

## Output

A short walk-through by statement, the ratio table with formulas, the changes that stand out and a list of questions. Close with a line that this explains figures and gives no advice.

Keep the walk-through under two pages and put questions last.
