---
name: i18n-readiness
description: Finds hardcoded strings and locale assumptions in a UI and prepares it for translation, covering message extraction, plurals, dates, numbers and text direction. Use when the user asks to make an app translatable, prepare for i18n, or support more languages.
---

# i18n readiness

## Goal

Move every user-visible string and locale-dependent format into a translation system without breaking the layout or the grammar. A good result lets a translator work from message files alone and lets the UI cope with longer text and other scripts.

## When to use

- The user wants an app prepared for more than one language.
- Strings are scattered in components or built by concatenation.
- For checking support of a specific web API across browsers, use `use_skill` with `browser-compat-check`.
- A launch in a new market is planned and the UI has never been translated.
- A translator reports strings they cannot understand without context.

## Steps

1. Check whether an i18n library or message files already exist. Use `search_files` for translation function calls, locale folders and library imports. Follow the existing convention if there is one.
2. If none exists, pick a library with the user, matching the framework. Check its current documentation with `read_url` or `search_web` before writing setup code, since APIs change.
3. Find hardcoded text with `search_files`: JSX text nodes, `title`, `placeholder`, `alt`, `aria-label` attributes, toast messages, validation errors and strings in non-UI code that reach the UI.
4. Extract in batches. Give keys that describe meaning and place, not the English text. Keep whole sentences in one message with named placeholders instead of joining pieces.
5. Handle plurals and gender with the library's plural syntax. Do not write `count === 1 ? ... : ...` in code, since many languages have more than two forms.
6. Replace manual date, number, currency and list formatting with the platform `Intl` formatters, passing the active locale.
7. Prepare the layout: allow text to grow by roughly a third or more, avoid fixed-width buttons, use logical CSS properties (`margin-inline-start`) so right-to-left languages mirror correctly.
8. Run the app and switch to a pseudo-locale or a long test language with `run_command` and `browser_navigate`. Look for clipped text, untranslated strings and broken sentences.
9. Add translator context: short notes beside ambiguous keys (is "Save" a verb or a noun, what the placeholders hold), in the format the library supports.
10. Set up the lookup order and fallback: user choice, then browser language, then default, and make missing keys visible in development.

## Gotchas

- Concatenated fragments ("You have " + n + " items") cannot be translated, because word order differs by language. Use one message with placeholders.
- English-only plural logic gives wrong text in languages with several plural forms. Use the library's rules.
- Reusing one key in two contexts breaks when a language needs different words for each. Split keys by meaning.
- Hardcoded locale in formatters (`"en-US"`) ignores the user's setting. Dates like 03/04 are ambiguous without the locale.
- Text inside images, SVG and canvas is invisible to extraction. List it for the user.
- Sorting and case conversion differ by locale. Use `localeCompare` and locale-aware case functions for user-facing text.
- Splitting a sentence around a link or bold word forces translators to split too. Use rich-text placeholders so the whole sentence stays together.
- Expanding strings by a flat percentage misses short labels, which can double in German or Finnish. Test with long and short extremes.
- Country is not language. Do not choose a locale from the IP address alone, and always allow a manual override.

## Output

- The setup change and a count of strings extracted, by area.
- A list of items left for a person: images with text, legal copy, strings from the backend.
- Notes on layout issues found under the long-text pass and how they were fixed.
- Hand over the list of keys needing context notes so the translators are not left guessing.
