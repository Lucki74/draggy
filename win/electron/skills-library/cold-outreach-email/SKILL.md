---
name: cold-outreach-email
description: Drafts a short first-touch sales email to a named prospect that opens with their situation and asks for one small next step. Use when the user asks for a cold email, a prospecting email, or a first message to a lead who does not know them.
---

# Cold outreach email

## Goal

Produce a first email a busy stranger can read in under twenty seconds and answer with one word. A good result names something true about the prospect, links it to a problem the seller can solve, and makes a small ask.

## When to use

- The user wants a first message to a prospect with no prior contact.
- The user pastes a prospect's name, role or company and asks for outreach.
- A reply to an existing thread belongs to `use_skill` with `follow-up-sequence`.
- The user wants to rework an email that already got a reply, which is a normal reply.

## Steps

1. Ask with `ask_user` for the seller's offer in one sentence, the prospect's role and company, and the one outcome the seller wants (reply, intro, or a short call).
2. If the user gave only a company name, find one recent, checkable fact with `search_web`, then confirm it with `read_url`. Note the date of the source.
3. Pick the hook: a fact about the prospect's work, not about the seller. If no real hook exists, say so and write a plainer email instead of faking one.
4. Write the subject line (three to six words, no tricks) and a body of four sentences or fewer: the hook, the likely problem, one line of proof the user supplied, the ask.
5. Make the ask small and answerable: a yes or no question, or a request to point to the right person.
6. Offer two variants that differ in the hook, not in wording.
7. Check each claim against what the user told you. Remove anything you inferred.
8. Read the draft aloud. If a sentence needs a breath, split it.
9. Offer to adjust tone (formal, warm, blunt) once the user has chosen a variant.
10. Suggest one follow-up reason now, so the user does not improvise later.

## Gotchas

- Leading with "I am the founder of" or the product name. The first line must be about the reader.
- Asking for thirty minutes of a stranger's time. A one-line question gets more replies.
- A hook that would fit any company in the same sector. If it survives a swap of the company name, it is not personal.
- Proof points the user never gave. Do not invent customer names, results or numbers.
- Pitching three features. One problem, one line.
- Tracking pixels and heavy formatting. Plain text reads like a person wrote it.
- Sending the same text to a list with only the name swapped. Recipients spot it in a line.
- Claiming a mutual connection or event that the user cannot confirm.

## Output

Two email drafts, each with subject and body, then a short list of the facts used and where each came from. Mark any line the user must verify. Do not send anything.
- Length: under 90 words per draft.
- Add a line telling the user which fact to double-check before sending.
