---
name: brand-voice-guide
description: Builds a usable brand voice guide from real writing samples, with traits defined by behavior, do and don't pairs, example rewrites, vocabulary lists and channel adjustments that a new writer can apply. Use when the user asks for a brand voice, tone of voice guide, writing style guide or consistent copy across channels.
---

# Brand voice guide

## Goal

A short guide a writer can apply on day one. Each trait is explained by what to do and not do, shown with before-and-after examples taken from the brand's own content. It reflects the brand as it is and wants to be, not a list of nice adjectives.

## When to use

- Several people write for the brand and the tone drifts.
- The brand is moving to a new audience or product and needs to sound consistent.
- For a single piece in the brand's voice, use `use_skill` with `blog-post`.
- For positioning that voice should reflect, use `use_skill` with `positioning-statement`.
- For rewriting text to remove generic phrasing, use `use_skill` with `human-social`.

## Steps

1. Ask with `ask_user` for the brand, audience, products and three to ten samples of writing the user likes (own or others'), plus samples they dislike. Read any files with `read_file` and public pages with `read_url`.
2. Read the samples for patterns: sentence length, person (we, you), humor, formality, jargon, punctuation, how problems and prices are described. Quote short examples, not whole pages.
3. Ask who the brand is as a person in one sentence, and who it would never sound like. Note the audience's own words from reviews or support if available.
4. Pick three to five traits. Define each by behavior: "Direct: states the answer in the first sentence" rather than "confident". Add the limit of each trait, where it would go too far.
5. For each trait write a do and a don't pair using the same message in two ways. Use real topics from the brand's work.
6. Build vocabulary lists: words and phrases the brand uses, words it avoids, how to name products and features, how to write numbers, dates and titles.
7. Add mechanics: contractions, capitalization, punctuation habits, emoji rules, inclusive language, reading level target.
8. Add channel adjustments: how the voice flexes for social posts, support replies, legal text, emails, error messages and ads. The traits stay, the intensity changes.
9. Write three before-and-after rewrites of generic text into the brand voice, and one test: a checklist of five questions a reviewer can answer yes or no.
10. Keep the guide to two pages. Mark open questions for the user to settle.

## Gotchas

- A list of adjectives ("friendly, professional, innovative") fits every brand and guides no one. Define behavior.
- A guide with no examples gets ignored. Include real before-and-after text.
- A voice no one in the team can sustain fails by week three. Check with the actual writers.
- Do not copy another brand's voice. Borrow principles, then adjust to your audience.
- Voice is not the same as tone. Voice stays, tone flexes with the situation, such as an apology versus a launch.
- Review the guide when the audience or product changes.
- A guide built from one writer's taste breaks when that person leaves. Base it on several samples and test it with a second writer.

## Output

Guide sections: summary line, traits with do and don't pairs, vocabulary, mechanics, channel notes, three rewrites, review checklist and open questions.
