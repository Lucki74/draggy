---
name: blog-post
description: Plans and writes blog posts and articles with a strong headline, a hook, a logical structure, concrete examples and a clear takeaway. Use when the user wants an article, blog post, newsletter piece or long-form post drafted or outlined.
---

# Blog post

## Goal

Deliver a post a specific reader finishes and remembers: one clear takeaway, an honest headline, sections that each make one point, and claims backed by examples or checked facts.

## When to use

- The user wants an article, blog post, newsletter piece or long-form post written or outlined.
- The user has rough notes and wants them shaped into a post.
- For release notes, use `use_skill` with `changelog`. For a letter to an employer, use `cover-letter`.

## Steps

1. Pin down the brief, asking only for what cannot be inferred:
   - the audience and what they already know
   - the single takeaway a reader should leave with
   - length (default about 900 words) and tone (default knowledgeable and conversational)
   - any facts, links, product details or quotes that must appear
2. Outline first: three headline options, the hook, three to six section headings each with one line on its point, and the conclusion. For long pieces, show the outline and carry straight on into the draft unless the user asked to approve it first.
3. Draft:
   - **Headline:** concrete and honest. Numbers and specifics beat vague promises.
   - **Hook:** open with a problem, a surprising fact, a short story or a question the reader has.
   - **Sections:** one idea each, with a subheading that says what it is. Support claims with an example, a number or a quote.
   - **Paragraphs:** two to four sentences. Use lists for steps or comparisons.
   - **Ending:** restate the takeaway in fresh words and give the reader a next step.
4. Check facts. If web access is available and the piece makes factual claims (statistics, dates, product details), verify them with `search_web` and `read_url`, and link the sources inline. Remove anything you cannot verify, or mark it [check].

## Gotchas

- Invented statistics and quotes. Never write a number or quote you have not seen in a source.
- Stock openers such as "In today's fast-paced world" tell the reader nothing. Start with the problem itself.
- A post with two takeaways usually delivers neither. If the brief has several, ask which one leads.
- Headlines that promise more than the post delivers cost trust. Make the headline match the content.
- Writing a long draft before the outline is agreed wastes effort when the user wanted to approve the structure.

## Output

The headline, then the post in Markdown, then a suggested meta description of about 150 characters. If the user wants a file, save it with `create_file` as .md or .docx.
