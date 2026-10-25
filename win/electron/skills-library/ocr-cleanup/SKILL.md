---
name: ocr-cleanup
description: Corrects typical OCR misreads in text from scanned pages, separating safe fixes from guesses and flagging uncertain spots instead of inventing content. Use when the user asks to fix OCR errors, clean up text from a scan, or says a scanned document has garbage characters.
---

# OCR cleanup

## Goal

Make scanned-document text accurate and readable while staying faithful to what the page says. A good result fixes the mechanical misreads, marks every doubtful spot for a human, and never turns an unreadable passage into plausible fiction.

## When to use

- Text from a scan or photo has swapped characters, broken words or stray symbols.
- The user has OCR output and the original image or PDF to check it against.
- For layout damage such as headers, columns and hyphenation in a PDF with a real text layer, use `use_skill` with `pdf-to-text-cleanup`.
- For OCR of a PDF that has no text yet, use `use_skill` with `pdf`.

## Steps

1. Identify the source. Ask with `ask_user` for the original scan if it was not provided, and for the document type (letter, invoice, book page, form). The type tells you what vocabulary to expect.
2. Read the text with `read_file`. Measure the damage: count lines with non-letter symbols, words not in the document's language, and digits sitting inside words.
3. Fix the safe classes with `run_code`, logging each rule and its count:
   - Confusable pairs in word context: `rn` and `m`, `cl` and `d`, `l` and `1` and `I`, `0` and `O`, `5` and `S`.
   - Broken ligatures and spacing: `f i`, doubled spaces, space before punctuation.
   - Stray marks from specks and folds: isolated `|`, `~`, `_` on their own line.
4. Treat numbers separately. Do not auto-correct digits in amounts, dates, reference numbers or codes. Instead run a consistency check: totals that do not add up, dates that do not exist, check digits that fail.
5. Handle names and rare terms by frequency. A word that appears three times spelled one way and once another is a likely misread. A name that appears once stays as read and gets a flag.
6. Insert a marker such as `[?original?]` at every spot you could not resolve, and keep a list with line numbers.
7. If the image is available and a vision-capable route exists, check the flagged spots against it. Otherwise hand the list to the user.
8. Spot-check ten random lines against the source and report the error rate you can see.
9. Offer a second pass only if the first left many flags.
   - Ask the user to resolve the top ten flagged spots and rerun the rules with those answers.
   - If the scan quality is the cause, suggest rescanning at higher resolution, flat and well lit.
   - Mention that deskewing and contrast changes before OCR help more than any text fix afterwards.
   - Do not rerun OCR yourself unless a tool is installed and the user agrees.
10. Save the unresolved list as its own file so a person can work through it.

## Gotchas

- A spell checker will cheerfully replace a correct surname or product code with a common word. Never run a dictionary pass over names, codes or foreign-language quotes.
- `1` to `l` fixes are context-dependent. `l0ok` is fixable, `1990` is not touched. Apply rules per token, not per file.
- Fixing a misread that the source really contains (an old typo, a dialect spelling) changes the record. Preserve the source unless the user wants a corrected edition.
- OCR on tables scrambles cell order. Mark table regions and recommend re-extraction instead of editing the text.
- Running the same cleanup twice must change nothing. If it does, a rule is too aggressive.
- Handwriting is outside what plain OCR cleanup can repair. If the source is handwritten, say that the text is a rough draft needing a human read.

## Output

- The language and document type you assumed.
- The cleaned text saved with `create_file`, next to the untouched OCR text.
- A rule log with counts, and a numbered list of unresolved spots with the line and the best two readings.
- One sentence on confidence: what was verified against the source and what was not.
