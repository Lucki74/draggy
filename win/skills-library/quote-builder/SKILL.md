---
name: quote-builder
description: Turns a list of items, quantities and rates into a clear price quote with subtotals, stated assumptions, validity period and exclusions. Use when the user asks to write a quote or estimate for a client, build a price estimate, or price a job.
---

# Quote builder

## Goal

Produce a quote the client can read once and understand: what they get, what it costs, what is not included, and how long the price holds. Every figure comes from the user. Tax, licensing and contract wording vary by place, so the user should check them live and with a professional.

## When to use

- The user is pricing a job, project or order for a client.
- The user has rough numbers and wants a clean document.
- A proposal with narrative and goals is `use_skill` with `sales-proposal-outline`.

## Steps

1. Ask with `ask_user` for the client name, the scope in plain words, the line items with quantity and unit rate, and the currency. Read a brief with `read_file` if one exists.
2. Ask how the user normally charges: fixed price, time and materials, or per unit. Ask for expenses that pass through at cost.
3. Compute each line and the subtotal with `run_command`. Show quantity times rate on every line.
4. Ask whether tax applies and at what rate. Add it only with a rate the user gives, and note that the rate must be confirmed.
5. Write the assumptions the price rests on: access, client inputs, number of revisions, timeline.
6. Write the exclusions: what is not covered, and how extra work would be priced.
7. Add validity (a date, not "30 days" alone), payment terms the user states, and the start condition.
8. Add a short acceptance line: the client replies to confirm, or signs, according to the user's practice.
9. Re-add the totals by hand and compare. Check the currency and date format.
10. Save as Markdown or text with `create_file`; offer a plain table for pasting into the user's template.
11. Offer a short cover email that points to the attached quote.
12. Offer an options version with two clear packages if the user wants to give the client a choice.

## Gotchas

- Adding a tax rate or deposit terms the user did not give.
- Vague scope words such as "support" or "as needed", which invite disputes.
- No exclusions, so the client assumes everything is included.
- Quoting without a validity date while costs move.
- Mixing hours and days in one rate column.
- Totals that change after rounding line items. Round once, at the end, and say which.
- Mixing one-off and recurring charges in one total.
- Forgetting travel, materials or third-party costs that the user will pay.

## Output

A quote with header, line-item table, subtotal, tax line if given, total, assumptions, exclusions, validity and next step. List the facts to confirm before sending.

Add the contact line the client should reply to.
