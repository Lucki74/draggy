---
name: press-release
description: Drafts a press release in news format, with a lead that states the news, supporting facts in order of importance, quotes supplied by the client and complete boilerplate and contact details. Use when the user asks to write a press release, announce a launch or hire, or turn company news into a release.
---

# Press release

## Goal

A release a journalist can use without a follow-up call. A good result leads with what happened and who it affects, gives the checkable facts, includes only quotes the speaker approved, and ends with a boilerplate and a working contact.

## When to use

- A product launch, partnership, funding round, hire, event or milestone needs an announcement.
- The user has facts and wants them in release form.
- For a blog version of the same news, use `use_skill` with `blog-post`.
- For the headline alone, use `use_skill` with `headline-writer`.
- Releases containing financial results of listed companies have legal rules; tell the user to have counsel review before sending.

## Steps

1. Gather facts with `ask_user` and `read_file`. Needed: what happened, who is involved (full names and titles), when, where, why it matters to the audience, any figures with their source, and the release date or embargo.
2. Ask who the audience is: trade press, local news, customers or investors. It sets the angle and the vocabulary.
3. Write the lead: one or two sentences with who, what, when, where, answering "so what" for the audience. No scene-setting, no company history up front.
4. Order the body by importance: the next most important fact first, then support, then context. A reader or an editor must be able to stop at any paragraph and still have the essentials.
5. Add quotes only from the people involved, and only the words the user supplies or confirms. A quote should carry a view or a reason, not repeat the facts. If none exist, leave a marked placeholder and tell the user it needs a real quote. Never write one for a named person.
6. Include numbers only if the user gives them and a source can be named. State the date range or sample for any statistic.
7. Add a short boilerplate: what the company does, in two or three plain sentences, factual and current. Ask the user for the approved text if one exists.
8. Add the contact block: name, role, email, phone, plus a link to assets or the full story. Mark release timing at the top ("For immediate release" or the embargo time with time zone).
9. Edit hard. Delete adjectives that cannot be proved: "leading", "innovative", "revolutionary". Keep to one page, about 300 to 500 words, unless the news needs more. Save with `create_file` if asked.
10. Add a short subheading under the headline if the news needs one more fact, such as a figure or location.
11. Check names, titles and spellings of every person and organisation against the user's source.

## Gotchas

- Invented quotes are the worst failure. A quote is a statement of record by a person; fabricating one misleads readers and the person named.
- Burying the news under company background loses the editor in two lines. The lead is the release.
- Superlatives with no proof get the release binned. Replace with a fact or remove.
- A release lacking a date, a location or a contact can look like spam. Check the block is complete and current.
- Embargo times without a time zone cause early publication. Always write the zone.
- Naming a customer or partner needs their permission. Ask before including it.
- A release with no news in it (a rebrand of a minor page, a routine update) will be ignored. Tell the user if the news is thin and suggest another channel.
- Dates and times written as "next Tuesday" age badly. Write the full date and the year.
- Include the link where the story lives, such as the product page. Check that it works before sending.
- Press lists and sending are outside this skill. Do not send anything; hand over the text.
- Photos and logos need rights. Ask who owns them before listing them as attachments.

## Output

- The release, ready to paste, with headline, dateline, body, quotes, boilerplate and contact block.
- A short list of missing items: quotes needing approval, facts needing a source, placeholders.
- A line saying which claims came from the user and which need verification.
