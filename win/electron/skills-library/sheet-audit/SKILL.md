---
name: sheet-audit
description: Audits a workbook for formula errors, hardcoded numbers, broken links, inconsistent formulas and hidden risks, then reports findings ranked by impact without editing the file. Use when the user asks to check a spreadsheet for errors, asks why totals are wrong, or wants a model reviewed before sending it.
---

# Sheet audit

## Goal

Find the problems that make a workbook give wrong answers, rank them by how much they could distort the result, and give the user a fix list. A good audit never changes the original, proves each finding with a cell address, and says what it did not check.

## When to use

- Totals do not match, or a number looks wrong and nobody knows why.
- A workbook inherited from someone else needs a safety review.
- A model is about to go to a client, a board or a bank.
- For writing a single formula, use `use_skill` with `spreadsheet-formulas`.
- For checking a data file rather than a model, use `use_skill` with `csv-cleaner`.

## Steps

1. Work on a copy. Use `list_directory` to find the file and `run_command` to copy it to a new name. Open nothing in write mode on the original.
2. Map the workbook with `run_command`: sheet names, visible or hidden state, used range, number of formulas and constants per sheet, defined names, external links, and any macros present. Print it as a short table.
3. Trace the flow. Identify the input sheets, the calculation sheets and the outputs. Draw it as a line of text: Inputs to Calc to Summary. Ask the user with `ask_user` what the key outputs are and what they should roughly equal.
4. Scan for errors. List every cell with an error value (`#REF!`, `#DIV/0!`, `#N/A`, `#VALUE!`, `#NAME?`) and trace each one back to its first cause, since one bad cell spreads down a chain.
5. Scan for consistency. In each row or column of formulas, find the cells whose formula differs in shape from its neighbours, which is often an overwritten or patched cell. List constants sitting in the middle of formula ranges.
6. Scan for hardcodes: numbers typed inside formulas such as `*1.2`, rates or dates that should be input cells, and values pasted over formulas.
7. Scan the structure: ranges in totals that stop short of the last row, SUMs that include their own subtotal rows, merged cells in data, lookups with approximate matching, volatile functions across large ranges, and circular references.
8. Check the hidden and the external: hidden sheets, rows and columns, named ranges pointing nowhere, links to files on someone's drive, and comments that say "temporary".
9. Reconcile the outputs: recompute the key totals independently with `run_command` from the raw data and compare. A difference is a finding with a number on it.
10. Write the report with `create_file`: findings ranked as Wrong results, Fragile, and Tidy. Each gets the sheet, cell, what is wrong, the effect and the fix.
11. Agree what happens next before leaving the report.
   - Ask the user which findings to fix, and in what order, starting with wrong results.
   - Offer to apply the fixes in a copy, one at a time, rechecking the key outputs after each.
   - Suggest guard cells that stay in the workbook, such as totals that must equal source sums.
   - Recommend a short change log sheet if several people edit the model.

## Gotchas

- Fixing while auditing hides the evidence and can change the result the user is asking about. Report first, change only on request, and in a copy.
- Recalculation may differ from the stored values when calculation is set to manual. Check the mode and the last calculated state.
- Totals that look right can be right for the wrong reason, such as two errors offsetting. Reconcile from the source, not from the next total.
- Hidden sheets are where the old assumptions live. Always list them, with their purpose if known.
- A clean scan is not a verdict that the model is correct. Business logic errors need the owner to confirm the rules.
- External links may point to files that hold the true inputs. An audit that cannot open them should say which results depend on unseen data.

## Output

- The proposed fix order.
- A summary line: number of findings by class and the likely effect on the key outputs.
- The ranked findings table with cell addresses and fixes.
- What was not checked, such as macros or logic against policy.
