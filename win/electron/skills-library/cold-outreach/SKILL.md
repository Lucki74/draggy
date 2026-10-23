---
name: cold-outreach
description: Drafts a short first-contact email to someone who does not know the sender, built around one specific reason for writing and one small ask. Use when the user says "cold email to a prospect", "write an outreach email" or "reach out to someone I do not know".
---

# Cold outreach

## Goal

Earn a reply from a stranger. A good cold email is short, shows the sender did their homework on the recipient, and asks for something small that is easy to grant.

## When to use

- Reaching out to a possible customer, partner, mentor, journalist, speaker or hire.
- Contacting a researcher or maintainer for the first time.
- Rewriting an outreach template that gets no replies.

For a warm introduction through a mutual contact, use `intro-email`. For a sales pipeline across many contacts, use the sales skills instead of this one.

## Steps

1. **Pin down the goal.** Call `ask_user` for: who the recipient is, what the user wants from them, and what the user offers or has in common. If the ask is vague ("pick your brain"), narrow it to one question or a 15-minute call.
2. **Research one real detail.** Use `search_web` or `read_url` on the recipient's page, a post, a talk or a product update. Pick a detail from the last year. Quote or paraphrase it accurately and cite nothing you did not read.
3. **Write the subject.** Six words or fewer, specific, no tricks. Use the recipient's topic or a shared contact, not "Quick question".
4. **Write the opening.** One sentence about them, tied to the detail. Do not open with the sender's name, company or years of experience.
5. **State the reason.** One or two sentences: why the user is writing and why this person in particular.
6. **Make the ask.** One ask, small, with a time cost attached ("Would a 15-minute call next week work?"). Offer a clear way to say no.
7. **Sign off with proof.** One line of credibility, such as a link to relevant work. A link only if the user has one.
8. **Cut.** Aim for 80 to 120 words. Delete adjectives like "exciting" and "innovative". Read it aloud once for tone.
9. **Check merge fields.** Scan for leftover placeholders, wrong names or a company that has been renamed.
10. **Find the address honestly.** Use a published contact or a professional profile message. Do not guess addresses or scrape lists. If only a generic inbox exists, say so and adjust the greeting.
11. **Plan the timing.** Suggest a weekday morning in the recipient's time zone. Note that this is a habit, not a rule, and the user should not delay sending to chase a perfect hour.
12. **Prepare one variant.** Offer a shorter version of three or four sentences for a social platform message, where length limits are tighter.

## Gotchas

- Flattery without a fact reads as automation. "Love your work" is worse than nothing.
- Two asks halve the reply rate. Pick the one that matters.
- Attachments in a first email can land it in spam and signal a bigger commitment. Link instead.
- Do not invent shared connections, mutual interests or results. If it cannot be checked in a minute, cut it.
- Check the recipient's published preferences. Some say not to contact them about certain topics, and some jurisdictions restrict bulk commercial mail. Look up the rule with `search_web` instead of guessing.
- A follow-up plan matters. Tell the user to wait about a week, then use `follow-up-email` once or twice, and stop.
- Praising a talk or article you only skimmed backfires when the recipient replies with a question about it. Read it first.
- Links to the sender's own pages in the opening lines look like an advertisement. Put one link at the end.
- Claiming a referral or a chance meeting that did not happen ends the thread. Say how you found them.

## Output

Subject line, then the email body, then a one-line note on what personalization was used and where the user should double-check a fact. Offer one alternate subject line. No lists of tips.

Keep the research notes (what was read and where) in a short list under the draft, so the user can verify each claim before sending.
