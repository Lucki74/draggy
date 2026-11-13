---
name: headline-writer
description: Writes headlines, titles and subject lines that describe what the piece delivers, offers a short range of distinct options by angle, checks length for the channel, and recommends one. Use when the user asks for headline options, a title for a post, or a better email subject line.
---

# Headline writer

## Goal

A headline that earns the click and then keeps its promise. A good result gives a small set of options that differ in angle, each accurate to the text, fitted to the channel's length, with one recommended and the reason.

## When to use

- A post, article, page or email has no title or a weak one.
- The user wants options to test.
- A title is truncated in search results or an inbox.
- For the body of the piece, use `use_skill` with `blog-post`.
- For sales emails as a whole, use `use_skill` with `email-writer`.

## Steps

1. Read the piece with `read_file`, or the summary the user gives. Find the single most useful thing a reader gains. Note any figure, name or outcome in the text that could appear in a headline.
2. Ask with `ask_user` only what is missing: the channel (search result, social feed, email inbox, print), the audience, and any words that must or must not appear, such as a keyword or a brand name.
3. Set the length from the channel. Search titles and email subjects are cut at a width that depends on the device, so keep the important words first. If the exact limit matters, check the platform's current guidance with `search_web`, because limits change.
4. Draft options along different angles, one per angle, not variations of one:
   - Direct: says what the piece is or teaches.
   - Result: the outcome or the number from the text.
   - Question: the question the reader already has, answered inside.
   - Contrast: a surprising finding, only if the text supports it.
   - Plain label: the safe, descriptive version.
5. Check each option against the text. Every claim in the headline must be in the piece. Remove any option the text cannot back.
6. Count length with `run_command` if a limit applies, and cut from the end of each option, not the middle.
7. Choose one, and say why in a sentence: it matches the audience's wording, leads with the key words, or is the most accurate.
8. Offer a subtitle or a preview line if the channel has room for one, with a different job from the headline: detail, not repeat.

## Gotchas

- A headline that overpromises gets the click and loses the reader. If the piece gives a partial answer, the headline must not claim the full one.
- Ten variants of the same sentence waste the user's time. Fewer options with real differences are worth more.
- Numbers draw attention only when real. Do not add "7 ways" because a list format is popular; use the count the piece has.
- Keyword stuffing for search makes the title read oddly. Put the main phrase in naturally, once.
- Title case on every word reads as a template. Match the publication's convention, and use sentence case if there is none.
- Cleverness that needs context fails in feeds, where readers have none. Test each option as if it were the only text seen.

## Output

- A short list of options, each labelled by angle, with its length where it matters.
- The recommendation and the reason in one sentence.
- Any claim in an option that the text only partly supports, flagged.
- Nothing else: no explanation of headline theory.
