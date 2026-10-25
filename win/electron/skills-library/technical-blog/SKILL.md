---
name: technical-blog
description: Writes a technical blog post around one problem and one solution, with code that was run, version-specific claims checked against live sources, and a structure that lets a reader apply the idea. Use when the user asks for a technical blog post, a write-up of how something was built, or an explanation of a technique for developers.
---

# Technical blog

## Goal

A developer reads the post and can use the idea. A good result opens on the concrete problem, shows the solution in code that works, explains why it works and where it fails, and states the versions and conditions it was tested under.

## When to use

- The user wants a post about a technique, a fix, an architecture decision or a build story.
- Notes, a pull request or a design doc must become a post.
- For a general (non-technical) blog post, use `use_skill` with `blog-post`.
- For a step-by-step procedure as the main product, use `use_skill` with `how-to-guide`.
- For title options, use `use_skill` with `headline-writer`.

## Steps

1. Clarify with `ask_user`: the reader (level and stack), the one thing they should be able to do or understand afterwards, the length and the publication's tone. Narrow to one problem. If the material holds three, propose three posts.
2. Gather material with `read_file`: code, notes, the pull request, logs, measurements. Mark what is a measured result and what is the author's impression.
3. Outline: the problem in a concrete case, why the obvious approach fails, the solution, how it works, trade-offs and limits, what to try next. Open on the case, not on background.
4. Write the code first. Run every snippet with `run_code` or `run_command`, in a clean directory with the versions you state. Keep each snippet short and runnable, and show full code in one place if the post needs it.
5. Check version-dependent claims against the source: library behaviour, defaults, deprecations, flags, performance statements. Use `read_url` on the official docs or changelog, and note the version and the date checked. If you cannot verify, say so in the post or cut the claim.
6. Write the prose around the code. Explain the idea in plain words before the detail, show a failing or naive version when it helps, and say why the fix works. Use "you" for the reader.
7. Report measurements honestly: what was measured, on what machine or data, how many runs, and the spread. Do not generalise from one run, and do not invent numbers.
8. Add limits and alternatives: when not to use this approach, what it costs, and what else exists.
9. Edit: remove the history of how the author got there unless it teaches. Check that the title matches the content. Save with `create_file`.
10. Offer a repository or gist with the complete working code, and link it from the post.
11. Re-read for assumed knowledge: define a term the first time unless the stated reader certainly knows it.

## Gotchas

- Snippets typed from memory often fail. Run them, and keep the output you saw for the post.
- Library behaviour changes between versions. A claim without a version is a trap for readers a year later.
- A post that teaches three techniques at once is read for none. Pick one and link out for the others.
- Benchmarks without method are noise. Either describe the setup or leave out the numbers.
- Pasting proprietary code or internal names into a public post is a leak. Ask what may be shown.
- Do not hide the failed attempts that explain the design; do cut the ones that do not.
- Security-related posts should not include working exploit detail for unpatched issues. Ask the user about disclosure status.
- Screenshots of terminals are hard to copy and read badly. Use text blocks.
- Opinions presented as facts ("X is slow") need a measurement or a reframe as the author's experience.
- Credit sources and prior work you built on, with links. Readers check, and so do the authors.
- Time-bound statements ("currently", "latest") age at once. Give the version and date instead.

## Output

- The post in Markdown, with a title, a short intro on the problem, sections, code blocks tagged with a language and a closing section with limits and next steps.
- A list of what was run and verified, with versions, and what is the author's opinion rather than a tested fact.
- Open questions for the author about permissions and unverified claims.
