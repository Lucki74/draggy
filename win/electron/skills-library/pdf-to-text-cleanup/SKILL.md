---
name: pdf-to-text-cleanup
description: Repairs text extracted from a PDF by fixing line breaks, hyphenation, repeated headers and footers, column order and ligatures, and reports what it changed. Use when the user says text from a PDF is a mess, or asks to clean up copied or extracted PDF text.
---

# PDF text cleanup

## Goal

Turn raw extracted PDF text into readable prose or structured text that matches the source, without rewording it. A good result has paragraphs where the source has paragraphs, no page furniture, and every change that could alter meaning listed.

## When to use

- Extracted text has hard line breaks in the middle of sentences.
- Page numbers, running headers or footers are mixed into the body.
- Columns, tables or footnotes came out interleaved.
- For extracting actual tables, use `use_skill` with `table-extraction`.
- For scanned pages with no text layer, use `use_skill` with `ocr-cleanup`.
- For general PDF operations, use `use_skill` with `pdf`.

## Steps

1. Get the text. If the user gave a file, use `run_command` with a PDF text tool that keeps layout order (such as `pdftotext -layout` if it is installed), or `run_code` with a PDF library. Check what is available first. Save the raw output next to the clean one so nothing is lost.
2. Check that a text layer exists. If the output is empty or garbage characters, stop and switch to the OCR skill.
3. Sample three pages with `read_file`: one from the start, one from the middle, one near the end. Note the page furniture lines, the column count, the hyphenation style and any odd glyphs.
4. Remove furniture with `run_code`: lines that repeat on most pages (title, author, chapter name) and bare page numbers. Match whole lines and print the candidates before deleting.
5. Fix columns. If the text reads across columns, re-extract with a column-aware mode or by cropping regions, instead of patching afterwards.
6. Join lines into paragraphs: a line break inside a sentence becomes a space, a blank line or an indent after a full stop starts a new paragraph. Rejoin words split by a trailing hyphen only when the joined form is a real word, checked against other uses in the text.
7. Normalise ligatures (`ﬁ`, `ﬂ`), curly quotes if the user wants plain text, and non-breaking spaces. Leave numbers, units and code blocks alone.
8. Compare word counts before and after, spot-read five passages against the PDF, and list the rules applied.
9. Run a final consistency pass before handing over.
   - Search for double spaces, lone single letters and lines that end mid-sentence.
   - Check that sentence-initial capitals follow every full stop you joined across.
   - Make sure quotes and brackets are balanced in each paragraph.
   - Confirm the section headings still sit on their own lines and were not merged into paragraphs.
10. Keep the rule list as a small script file if the user has more PDFs of the same kind.

## Gotchas

- Dehyphenating everything damages real compounds such as `well-known` or `state-of-the-art` that happened to break at the hyphen. Join only when the stitched word appears elsewhere without a hyphen.
- A header that changes per chapter does not repeat exactly. Match by position near the page top, not by exact text.
- Footnotes land in the middle of the body. Move them to the end or tag them, do not leave them inside sentences.
- Mathematical text, tables and code lose structure in plain text. Flag those regions instead of reflowing them.
- Do not fix typos or style. Cleanup repairs extraction damage only.
- Text in right-to-left scripts or with complex shaping can come out reversed or split. Check a sample with the user if the document is not in a left-to-right language.

## Output

- A one-line statement of the extraction tool and mode used.
- The cleaned text saved with `create_file`, and the raw file kept.
- A short list of rules applied with counts, such as lines removed or words rejoined.
- Regions left as is because they could not be repaired safely.
