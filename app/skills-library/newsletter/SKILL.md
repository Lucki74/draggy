---
name: newsletter
description: Writes one newsletter issue for a defined audience, with a subject line, a lead item that carries the issue, short sections with the reason for each link, and a single clear call to action. Use when the user asks for a newsletter draft, this week's issue, or to turn a list of updates into a newsletter.
---

# Newsletter

## Goal

An issue that people open and read to the end. A good result has one lead item, a subject line that matches what is inside, sections short enough to scan, links that each come with a reason to click, and one thing the reader is asked to do.

## When to use

- The user has updates, links or posts and wants an issue assembled.
- A recurring newsletter needs its next edition drafted in the same voice.
- For a one-to-one or announcement email, use `use_skill` with `email-writer`.
- For subject line options only, use `use_skill` with `headline-writer`.

## Steps

1. Collect material with `read_file` or from the message. Ask with `ask_user` for: the audience, how often it goes out, the usual tone, any fixed sections, and previous issues if there are any to match.
2. If previous issues exist, read two or three and note their structure, length, sign-off and how they handle links. Keep that shape unless asked to change it.
3. Choose the lead. Pick the single item most useful or interesting to this audience this week. Everything else is supporting. If everything is equal, the issue has no lead yet: ask the user which matters most.
4. Draft the lead section in 100 to 200 words: what it is, why the reader should care, what to do. Add the detail a reader would otherwise have to click to find.
5. Draft the rest as short items. Each gets a line on what it is and a line on why it matters, then the link. Drop items that fail the "why" test.
6. Write the subject line last, from the lead. Add a preview line that adds information instead of repeating the subject. Keep the subject short enough to display on a phone; check the sender platform's guidance if exact width matters.
7. Add one call to action: reply, read, register, share. If two are present, keep the more important and move the other to a footer line.
8. Check links: every link named in the text must have a URL from the user. Use `read_url` to confirm that supplied URLs resolve and match their description. Mark any you could not check.
9. Read it as the subscriber: could they skim it in a minute? Cut anything that makes them scroll for nothing. Save with `create_file` if wanted.
10. Provide a plain-text fallback: a version without images or formatting, in case the email client strips them.
11. If the newsletter repeats weekly, note the structure you used so the next issue starts from it.

## Gotchas

- A newsletter with six equal items has no hook, and readers learn to skip it. Pick a lead.
- A misleading subject line raises opens once, then costs trust and unsubscribes. The subject must match the lead.
- Links without context ("check this out") ask the reader to spend a click on faith. State what they get.
- Writing about "we" when the reader wants "you" changes the tone to internal news. Lead with the reader's benefit.
- Inventing statistics or events to fill a slot is easy to do and expensive to retract. Use only supplied material.
- Email platforms add legal footers, such as unsubscribe links and sender address, which the platform usually inserts. Do not remove or fake them.
- Length creep: each issue gets a little longer until no one finishes it. Hold the word count steady.
- Images carry meaning only if they load. Give alt text and make the text complete without them.
- Time-sensitive items need the date written out. "This Friday" in an issue opened two weeks later is wrong.
- Affiliate links or sponsored items must be labelled as the user's local rules require. Ask if any are present.
- Do not scrape or invent subscriber data to personalise. Use only fields the user says exist.

## Output

- Subject line, preview line, then the full issue body in the user's usual format.
- A list of links to verify or items that lacked a URL.
- A note on what was left out and why, so the user can swap items.
