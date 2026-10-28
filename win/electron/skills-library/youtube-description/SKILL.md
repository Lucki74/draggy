---
name: youtube-description
description: Writes title options, a video description, chapter timestamps and tags from a script or transcript, honest to the content and checked against the platform's current limits. Use when the user asks for a YouTube description, video titles, or chapters for a video.
---

# YouTube description

## Goal

Package a finished video so the right viewers find it and know what they get. The title and the first lines of the description are accurate and specific, chapters match the video, and nothing is promised that the video does not deliver.

## When to use

- The user has a script, transcript or outline and is about to upload.
- The user wants title ideas or a rewrite of a weak description.
- For the thumbnail, use `use_skill` with `thumbnail-brief`. For podcast-style notes, use `use_skill` with `show-notes`.

## Steps

1. Read the script or transcript with `read_file`. Ask with `ask_user` for the audience, the main search phrase a viewer would type, the channel's tone, links to include (sources, related videos, products) and sponsor or affiliate disclosures that apply.
2. Check the platform's current limits for title length, description length, tag use and chapter rules with `search_web` and `read_url` on the official help pages. Platforms change these, so do not use remembered numbers. Chapters usually need a first timestamp at the start and a minimum count, but confirm.
3. Write five title options that differ in angle: a plain descriptive one, a benefit, a question, a number-led one and a curiosity one that is still accurate. Put the key phrase early. Mark the one you would pick and say why.
4. Write the opening two lines of the description as the pitch: what the video covers and who it is for, with the main phrase used naturally. Many viewers see only these lines.
5. Build chapters from the transcript timestamps. Use `run_command` to verify the list starts at the right time, increases, and uses the format the platform requires. Labels are short and describe content.
6. Add the supporting sections in this order: summary paragraph, chapters, links and sources, about the channel, disclosures. Use only links the user gave or that you verified with `read_url`.
7. Offer a few tags or hashtags if the platform still uses them, based on the content and not on trending topics unrelated to the video.
8. Save with `create_file` as `description.md`.
9. Check the pinned-comment idea: one question to the audience or a correction slot. Offer it as optional text.

## Gotchas

- Titles that overpromise raise early clicks and hurt retention. Compare the title to the first minute of the video.
- Chapter times copied from a draft cut will be wrong after final edits. Ask for the final timeline.
- Stuffing keywords makes the text unreadable and does not help. Use the phrase once or twice, naturally.
- Missing sponsor or affiliate disclosure can break platform rules or local law. Ask, and do not decide it alone.
- Links with tracking parameters the user did not choose should be left out.
- Descriptions are read on phones where only the first lines show. Put the key information there.
- Repeating the title as the first line wastes the best space. Add new information.
- Sources for factual claims in the video belong in the description. List them if the script used them.

## Output

- An optional pinned comment.
- Five titles with the recommended one marked.
- The full description text ready to paste, with chapters.
- Items to confirm: sponsor lines, final timestamps, link addresses.
