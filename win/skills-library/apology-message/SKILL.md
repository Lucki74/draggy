---
name: apology-message
description: Writes a work or customer apology that names the mistake, owns it, says what changes and does not grovel or make excuses. Use when the user says "apologize to the client", "I messed up, write an apology" or "say sorry for the delay".
---

# Apology message

## Goal

Repair trust after an error. A good apology is specific, short, takes responsibility in the first person, states what is being done about it, and asks for nothing in return.

## When to use

- A missed deadline, wrong figure, dropped ball, late reply or rude remark at work.
- A service failure the user's team caused.
- A message to a colleague, client or customer after something went wrong.

For a consumer writing to a company about the company's fault, use `complaint-letter`. For a tense face-to-face talk, use `difficult-conversation-prep`.

## Steps

1. **Establish the facts.** Call `ask_user` for: what happened, when, who was affected, what it cost them, and what is already fixed. If the user pasted a thread, call `read_file` and quote nothing the other person did not see.
2. **Check whose fault it was.** If the user is only partly responsible, ask what part is theirs. The apology covers only that part.
3. **Pick the channel and size.** A small slip gets two or three sentences in chat. A serious one gets a full email, and maybe a call first. Say which you chose.
4. **Draft in this order.**
   - The apology and the specific error, in one or two sentences.
   - The impact on the reader, stated plainly.
   - What has been done or will be done, with a date the user can keep.
   - How the user will prevent a repeat, only if there is a real change.
5. **Use first person and active voice.** "I sent the wrong file" not "a mistake was made".
6. **Leave out the defence.** Delete "unfortunately", "due to circumstances" and any reason that sounds like an excuse. Give a cause only if the reader needs it to trust the fix, and keep it to one sentence.
7. **Do not ask for forgiveness.** Closing with "please accept my apology" pushes work onto the reader. End on the next step.
8. **Test the dates.** Confirm the user can meet every promise in the draft. Cut or soften any they cannot.
9. **Read it as the injured party.** Ask: would I feel heard, or managed? If the first line is about the writer's feelings, move the fact of the error up.
10. **Choose the timing.** Send as soon as the facts are known. If the fix takes days, send a short note now and a second message when it is done.

## Gotchas

- "I am sorry if you were offended" is not an apology. Name the act, not the reader's feelings.
- Over-apologizing makes the reader manage the writer's guilt. One clear sorry is enough.
- Promising compensation, refunds or credits needs the user's authority. Ask before including any.
- Blaming a teammate in a message to a client will be read by the client and the teammate. Keep internal fault out of external notes.
- If the error has legal, safety or data-breach weight, tell the user to check with the right person at their organization before sending. Do not draft statements of liability.
- A late apology needs one line acknowledging the delay in apologizing, otherwise it reads as unaware.
- Promising "this will never happen again" cannot be kept. Describe the specific change instead.
- A group apology to a whole list for one person's loss feels cheap. Send the personal note to the person, a short notice to the group.
- Humor to lighten the mood tends to read as not taking it seriously. Leave it out until the other person uses it first.

## Output

The message ready to send, with a subject line if it is an email. After it, one line listing any promise in the text the user must confirm they can keep. No coaching on how apologies work.

For a serious case, also give a two-sentence opening the user can say aloud if they choose to call first.
