---
name: faq-schema-builder
description: Builds FAQ content with matching JSON-LD structured data, with questions from real customer queries, plain factual answers, markup that mirrors the visible text exactly, and a check against current search guidelines. Use when the user asks for FAQ schema, structured data for a FAQ section or FAQ markup for a page.
---

# FAQ schema builder

## Goal

A visible FAQ section on a page and JSON-LD markup that matches it word for word. The questions come from real queries, the answers are factual and helpful, and the markup follows what search engines currently document.

## When to use

- The user has a page with questions and answers and wants it marked up.
- The user is writing an FAQ for a product, service or help page.
- For FAQ content without markup, use `use_skill` with `faq-builder`.
- For wider technical checks on a page's HTML, use `use_skill` with `seo-technical-html`.
- For auditing the whole page, use `use_skill` with `seo-audit-page`.

## Steps

1. Ask with `ask_user` for the page URL or file, the topic and where questions come from (support tickets, sales calls, search suggestions). Read the page with `read_url` or `read_file`.
2. Check current guidance before writing. Fetch the search engine's structured data documentation for FAQ and the schema.org FAQPage type with `read_url`, and note eligibility rules, since display of FAQ results has been limited to certain kinds of sites and can change. Record the date checked.
3. Gather real questions: customer messages, forum threads, "people also ask" style questions seen through `search_web`. Pick five to ten that readers actually ask.
4. Write answers that are direct and factual. Start with the answer, then add the detail. Keep them short enough to scan, with links only where useful. State prices, terms and policies exactly as the business applies them.
5. Place the FAQ in the visible body of the page. Every question and answer in the markup must appear on the page in the same words.
6. Build the JSON-LD with `@context` as schema.org, `@type` as FAQPage, and `mainEntity` as a list of Question items, each with a name and an `acceptedAnswer` of type Answer with text. Escape quotes and keep any HTML in answers to the allowed simple tags.
7. Validate syntax with `run_command` by parsing the JSON, and compare each name and text with the page's visible text. Recommend running the page through the search engine's rich results test and the schema validator after publishing.
8. Insert into the page with `edit_file` only if the user asked, placing the script tag in the head or body.
9. Avoid duplication: the same FAQ markup on many pages is weak. Each page should hold its own questions.
10. Note a recheck date, since guidelines and eligibility change.

## Gotchas

- Markup that differs from the visible text breaks the guidelines and risks losing rich results. Mirror the page.
- Assuming FAQ rich results always show is wrong. Eligibility has changed over time. Check the current documentation.
- Promotional answers ("Our product is the best") are not answers. Keep them informative.
- Questions invented for keywords, which no reader asks, add clutter.
- Invalid JSON, such as trailing commas or unescaped quotes, voids the markup.
- User-generated answers belong to a different type (QAPage). Do not mix them.
- Markup placed on a page where the FAQ is hidden behind a login or not rendered breaks the match rule. Keep it visible.

## Output

The visible FAQ block in HTML, the JSON-LD script, the checks done with their results, the guideline sources with the date, and a recheck reminder.
