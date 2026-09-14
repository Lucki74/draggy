---
name: invoice
description: Prepares invoices and quotes with numbered line items, correct arithmetic, tax, totals and payment details, as a PDF to send and a spreadsheet of the lines if wanted. Use when the user asks for an invoice, a quote, an estimate or a bill.
---

# Invoices and quotes

## Collect

- Seller: name or business name, address, email, and tax or company number if they have one.
- Client: name, address, and their reference or purchase order number if any.
- Invoice number and date, and due date (or payment terms such as 30 days).
- Line items: description, quantity, unit price.
- Tax rate(s) and whether prices include tax. Currency.
- Payment details: bank account (IBAN/BIC or local equivalent), or payment link. Never guess these: leave a placeholder.

Ask for missing required details, or use clearly marked placeholders.

## Arithmetic

1. Line total = quantity × unit price, rounded to 2 decimals.
2. Subtotal = sum of line totals.
3. Tax = subtotal × rate, per rate if several rates apply.
4. Total = subtotal + tax.
Compute carefully, then re-add everything a second time before writing. Show amounts with two decimals and the currency.

A quote uses the same layout titled "Quote" with a validity date instead of a due date.

## Document

Create a .pdf with create_file using this layout:

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

Add any legally required mentions only if the user states them (for example VAT exemption wording). If the user wants the lines in a spreadsheet too, also create an .xlsx with one row per line item.

In the reply, give the total and the file name(s).
