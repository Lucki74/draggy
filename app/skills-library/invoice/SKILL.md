---
name: invoice
description: Prepares invoices and quotes with numbered line items, correct arithmetic, tax, totals and payment details, as a PDF to send and a spreadsheet of the lines if wanted. Use when the user asks for an invoice, a quote, an estimate or a bill.
---

# Invoices and quotes

## Goal

A document the user can send as is: every required detail present or clearly marked as a placeholder, and totals that add up. This is analysis and planning help, not investment, tax or legal advice, and it promises no returns. Tell the user to check decisions with a licensed advisor.

## When to use

- The user asks for an invoice, a quote, an estimate or a bill.
- For a styled PDF beyond the layout below, use `use_skill` with `pdf`.
- For a spreadsheet with formulas, use `use_skill` with `xlsx`.

## Steps

1. Collect the details:
   - Seller: name or business name, address, email, and tax or company number if they have one.
   - Client: name, address, and their reference or purchase order number if any.
   - Invoice number and date, and due date (or payment terms such as 30 days).
   - Line items: description, quantity, unit price.
   - Tax rate(s), whether prices include tax, and the currency.
   - Payment details: bank account (IBAN/BIC or local equivalent) or payment link.
   Ask for missing required details, or use clearly marked placeholders.
2. Do the arithmetic:
   1. Line total = quantity x unit price, rounded to 2 decimals.
   2. Subtotal = sum of line totals.
   3. Tax = subtotal x rate, per rate if several rates apply.
   4. Total = subtotal + tax.
   Compute carefully, then re-add everything a second time before writing. Show amounts with two decimals and the currency.
3. A quote uses the same layout titled "Quote" with a validity date instead of a due date.
4. Create a .pdf with `create_file` using this layout:

```
# Invoice [number]

**From:** [seller details]
**To:** [client details]
**Date:** [date] · **Due:** [due date]

| # | Description | Qty | Unit price | Total |
|---|---|---|---|---|
| 1 | [item] | [qty] | [price] | [total] |

| | |
|---|---|
| Subtotal | [amount] |
| Tax ([rate]%) | [amount] |
| **Total due** | **[amount]** |

**Payment:** [bank details or link], reference [invoice number]
```

5. If the user wants the lines in a spreadsheet too, also create an .xlsx with `create_file`, one row per line item (as an HTML table with styled headers and column widths, or clean CSV).

## Gotchas

- Never guess bank details or payment links. A wrong IBAN sends the client's money to a stranger, so leave a placeholder.
- Add legally required mentions only if the user states them, for example VAT exemption wording. Do not invent legal text.
- Prices that already include tax change the tax calculation. Confirm which applies before computing.
- Rounding per line and rounding the total can differ by a cent. Round each line first, then sum.

## Output

The saved .pdf (and .xlsx if requested). In the reply, give the total and the file name(s).
