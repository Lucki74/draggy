---
name: backlink-outreach
description: Plans honest link-earning outreach by finding pages where a link genuinely helps readers, writing a short personal email that offers something useful, and tracking replies, without paid link schemes or mass templates. Use when the user asks for backlink outreach, link building emails or ways to earn links to a page.
---

# Backlink outreach

## Goal

A small list of relevant sites, a reason each would want to link, a short personal message for each and a tracker. Links come from usefulness, not payment or trickery.

## When to use

- The user has a strong page, tool, study or guide and wants it noticed by relevant publishers.
- The user wants to fix broken or unlinked mentions.
- For general cold messages, use `use_skill` with `cold-outreach`.
- For a follow-up after silence, use `use_skill` with `follow-up-email`.
- For finding topics worth creating, use `use_skill` with `competitor-content-gap`.

## Steps

1. Ask with `ask_user` for the page to promote, what makes it worth citing, the audience, the user's name and role, and any rules on contact. Read the page with `read_url` and confirm it is something a site would be glad to cite.
2. If the page is thin, say so and suggest improving it first. Outreach for a weak page wastes goodwill.
3. Find opportunities: resource pages on the topic, articles that cite outdated or broken sources, lists that omit this resource, communities and newsletters in the niche, and unlinked brand mentions. Use `search_web` with varied queries and open candidates with `read_url`.
4. Qualify each target: relevant to the topic, real readers, editorial standards, a contact route (named editor or form). Drop link farms, "write for us" pages that sell links and sites with no audience.
5. Write the reason to link for each target in one line: what is missing or broken on their page and how yours helps their readers.
6. Write the message: a specific subject, a first line that shows you read their page, the problem you noticed, what you offer and a light ask. Keep it under about 120 words, plain text, with your real name and a way to opt out of further contact.
7. Offer value beyond the link when real: a correction, a quote, data, a guest piece they would want, an update to their list. Never offer payment or free products for links.
8. Build a tracker with target, contact, date, message version, reply, next action and outcome. Plan one follow-up after about a week, and stop after that.
9. Check rules: honor requests to stop, store only business contact data that is publicly listed and follow local email rules on unsolicited messages.
10. Review after the round: reply rate, what worked, which pages earned links, and whether the page itself needs work.

## Gotchas

- Paid links and link exchanges at scale breach search engine guidelines and can lead to penalties. Do not propose them.
- Mass templates are obvious and get ignored or blocked. Personalize each message to the target page.
- Asking without offering anything is a request for free work. Show the gain for their readers.
- Do not promise rankings or numbers of links.
- Do not misrepresent who you are or claim a relationship that does not exist.
- A link from a page nobody reads has little value beyond the referral. Choose relevance over count.
- Editors receive many pitches. A message that needs scrolling or a long reading is deleted unread.

## Output

A target table (site, page, reason to link, contact, status), the message template with two personalized examples, the follow-up message, the tracker columns and the review plan.
