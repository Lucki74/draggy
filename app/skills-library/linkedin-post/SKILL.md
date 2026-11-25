---
name: linkedin-post
description: Writes a LinkedIn post from the user's real experience or a verified idea, with a specific opening line, one point, short paragraphs and a single question or action at the end, in the user's own voice. Use when the user asks for a LinkedIn post, a professional update, a thought leadership post or a post about a launch, lesson or hire.
---

# LinkedIn post

## Goal

A post a real person would write and a peer would finish reading. It has a concrete first line, one clear point, details only the user could know and a light ending. No invented stories, no hashtag pile.

## When to use

- The user wants to share a lesson, result, launch, opinion, hire or event on LinkedIn.
- The user has a draft that sounds generic and wants it sharper.
- For other social networks, use `use_skill` with `social-post`.
- For making the text sound less machine-written, use `use_skill` with `human-social`.
- For several posts from one source, use `use_skill` with `content-repurpose`.

## Steps

1. Ask with `ask_user` for the topic, what actually happened (facts, numbers, dates, names that may be shared), the audience, the goal (visibility, hiring, leads, credibility) and two or three posts by the user that they like their voice in. Read samples with `read_file`.
2. Find the one point. Complete this: "The thing I want a reader to take away is ...". If there are three points, plan three posts.
3. Collect material from the user: the situation, the mistake or turning point, a detail with a number, what changed. If it is missing, ask. Do not make up a story, a client, a quote or a result.
4. Write the opening line so it stands alone before the "see more" cut: a specific fact, a surprising result or a plain statement of a problem. Avoid greetings, "I'm excited to announce" and rhetorical hooks.
5. Draft the body in short paragraphs of one to three lines. Show the situation, what was tried, what happened and the lesson. Use the user's phrasing, contractions and level of formality.
6. Keep one idea per post. Cut the second lesson, the third example and the recap.
7. End with a real question the user wants answered, a simple takeaway or a link with a reason to click. One ending only.
8. Add at most three relevant hashtags, or none. Tag people or companies only with the user's consent and only when they are part of the story.
9. Check the claims: each number, name and outcome came from the user. Check for confidentiality, such as client names, unreleased figures or colleagues' private news.
10. Offer two alternate opening lines and note a good time to post if the user knows their audience's habits. Do not cite timing statistics.

## Gotchas

- A generic opener ("Here are 5 lessons I learned") reads like every other post. Start from the specific moment.
- Invented personal stories are discovered quickly and damage trust. Use real material only.
- Hashtag clutter and emoji bullets make a post look automated.
- Praise for a company or person as a thin disguise for self-promotion falls flat. Lead with the reader's value.
- Do not name a client, employer plan or colleague without permission.
- Long posts need white space. Avoid walls of text and blocks of bold.
- Posts that tag many people or links in the body can look spammy. Put the link in a comment only if the user prefers, and test what suits their audience.

## Output

The post text ready to paste, with two alternate first lines and a short note listing the facts to confirm before posting.
