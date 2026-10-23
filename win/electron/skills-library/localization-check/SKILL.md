---
name: localization-check
description: Reviews translated app or website strings for one locale, checking placeholders, plurals, length, tone, terminology, formats and untranslated leftovers, and reports fixes per key. Use when the user wants a translation file, i18n resource or UI copy checked before release, or asks if translated text reads naturally.
---

# Localization check

## Goal

Find the problems in a translated string set that a build will not catch: broken placeholders, wrong plural forms, inconsistent terms, text too long for the UI, stiff tone and formats from the wrong locale. The result is a list of exact fixes, key by key.

## When to use

- The user has JSON, PO, XLIFF, strings or similar resource files in a target locale.
- The user wants to confirm a machine or freelance translation before shipping.
- The user wants a one-off translation: use `use_skill` with `translator`.
- The user wants politeness level reviewed: use `formal-vs-informal`.

## Steps

1. **Set the scope.** Use `ask_user` for the locale (language and region), the product type, the audience, the tone wanted and which files hold the source and target strings.
2. **Find the files.** Use `list_directory` and `search_files` to locate resource files for the source and target locales, and note the format and key naming.
3. **Read both sides.** Use `read_file` on the source and the target. Pair strings by key and list keys missing on either side.
4. **Check placeholders.** For each pair, confirm that variables, tags and format markers appear in the target exactly as in the source, with no spaces added or names translated.
5. **Check plurals and gender.** Compare the plural categories the locale needs against what the file provides. Look for strings that build sentences from pieces, which break grammar in other languages.
6. **Check terminology.** Build a list of repeated terms (button names, product words). Flag a term translated two ways, and any term left in the source language without reason.
7. **Check tone and register.** Read for naturalness: literal word order, stiff phrasing, wrong formality. Compare with the product's tone of voice.
8. **Check length.** Flag targets much longer than the source for buttons, tabs and labels, since they may clip. Suggest shorter wording.
9. **Check formats.** Look for dates, numbers, currency, units, quotation marks and punctuation spacing that follow the wrong locale.
10. **Verify the doubtful.** Look up uncertain wording with `search_web` and `read_url`, and mark each finding as error, risk or preference.
11. **Write the report and fixes.** Save a table with key, issue, current text, suggested text and severity using `create_file`. Apply fixes with `edit_file` only if the user asked, and keep keys and placeholders untouched.

## Gotchas

- Never rename keys or edit placeholders while fixing text. A fixed sentence with a broken variable crashes at runtime.
- Plural rules differ widely. A two-form file is wrong for languages with three or more forms.
- Concatenated strings cannot be localized well. Flag them as a source problem to fix in the code.
- A glossary may exist in the project. Search for one before imposing your own terms.
- Right-to-left locales need layout checks that a text review cannot give. Say so.
- Do not mark preference as error. Separate defects from taste in the report.
- Keep the review to the strings. Do not edit source code unless the user asks.

## Output

A summary count by severity, then the table of findings with exact replacements, and a short list of source-code issues. State the file path of the report.
Mention the number of keys reviewed and any left out.
