---
name: formal-letter
description: Writes formal letters (complaints, requests, resignations, notices, letters to authorities or landlords) with the correct layout and firm, polite wording, saved as Word or PDF. Use when the user needs an official or formal letter rather than an email, or asks for a complaint letter, resignation letter or letter to a landlord.
---

# Formal letter

## Goal

A letter that states who is writing, what happened, what is wanted and by when, in a calm tone, laid out the way the recipient's country expects.

## When to use

- The user needs an official letter: complaint, request, resignation, notice, letter to an authority or landlord.
- For a job application letter, use `use_skill` with `cover-letter`.
- For an email instead of a letter, use `use_skill` with `email-writer`.

## Steps

1. Collect the facts: sender, recipient and their title, dates, amounts, reference numbers, what the user wants, and the deadline. Ask for what is missing or mark it as a placeholder.
2. Lay out the letter, adjusting to the country's convention:
   1. Sender's name and address (top, or top right in some countries).
   2. Date.
   3. Recipient's name, title, organisation and address.
   4. Reference line if there is one: account number, case number, invoice number.
   5. Subject line, for example "Subject: Request for refund of order 5512".
   6. Salutation: "Dear Ms Rossi," or "Dear Sir or Madam," if the name is unknown.
   7. Body.
   8. Closing: "Yours sincerely," (name known) or "Yours faithfully," (name unknown) in British English; "Sincerely," in American English. Use the equivalent in other languages.
   9. Name and signature space.
   10. Enclosures, if any, for example "Enclosures: copy of receipt".
3. Write the body in this order:
   - First paragraph: who you are in relation to them and why you are writing.
   - Middle: the facts in order, with dates, amounts and references. Stay factual, with no emotional language even in complaints.
   - Request: exactly what you want, and by when ("within 14 days of the date of this letter").
   - Consequence, where appropriate: the next step if there is no response, stated calmly.
   - Close: thanks, and how to contact the sender.
4. Save with `create_file`: .docx if the user will edit or sign it digitally, .pdf if it is ready to send. For layout control in a PDF, use `use_skill` with `pdf`.

## Gotchas

- For legal matters such as tenancy disputes or contract termination, mention notice periods only if the user provided them, and suggest checking the exact rules locally. Legal advice presented as certain can mislead.
- Anger in a complaint weakens it. Dates, amounts and a clear request carry more weight.
- Sincerely versus faithfully depends on whether the recipient is named. Match the closing to the salutation.
- A request with no deadline gets no reply. State the date or number of days.

## Output

The letter shown in full, then the saved file name, then a list of any placeholders the user must fill in.
