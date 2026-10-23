---
name: slack-message-writer
description: Writes or tightens Slack, Teams and other work chat messages so the reader can act without a follow-up question, with the ask first and the context in a thread. Use when the user says "write a slack message", "how should I word this in chat" or "make this DM shorter".
---

# Slack message writer

## Goal

Make a chat message that gets the right answer from the right person in one reply. A good message is a few lines long, opens with the point, names who should act and by when, and keeps the detail where it will not clutter the channel.

## When to use

- Asking a question or making a request in a work channel or DM.
- Posting an update, a heads-up or an incident note to a team.
- Shortening a long chat message that nobody answered.

For formal or long updates, use `status-update`. For messages with legal or HR weight, or tense talks, use `difficult-conversation-prep` first.

## Steps

1. **Understand the aim.** Call `ask_user` if unclear: what outcome is wanted, from whom, by when, and what is the channel norm (casual, formal, public, private). If the user pasted a draft, keep their facts.
2. **Pick the venue.** A question for one person is a DM or a thread reply. A question the team shares is a channel post. A sensitive matter is a call or a DM, not a channel. Say what you chose.
3. **Write the first line as the ask or the news.** "Can you review PR 412 by Thursday noon?" comes before any background. Put the name or handle of the person who must act at the start.
4. **Add only the context needed to answer.** One to three lines: what, where (link), what has been tried. Move anything longer into a thread reply under the message.
5. **State the deadline and the reason for it.** If there is no deadline, say "no rush" instead of leaving it open.
6. **Make the answer easy.** Offer a yes or no, or two options. For a decision, say what you will do if you hear nothing.
7. **Format lightly.** Use short paragraphs, a bullet list for three or more items and a code block for logs or commands. Keep emoji to what the team already uses.
8. **Check the audience.** Avoid @channel and @here unless the message affects everyone now. Check that no secret, token, customer detail or salary figure is in the text.
9. **Offer a thread plan.** If the topic needs discussion, suggest posting a one-line summary in the channel and keeping the debate in the thread.
10. **Match the platform.** Slack, Teams and Discord render markdown differently. Ask which one, and avoid syntax it does not support, such as tables.
11. **Read it cold.** Imagine the reader opening it between two meetings. If they need to scroll or click to understand the ask, cut or link.

## Gotchas

- A lone "hi" or "quick question?" forces a wait. Send the whole message at once.
- Several short messages in a row each trigger a notification. Send one message.
- Tone is hard to read in chat. A blunt "why did you do this" lands harder than meant. Rephrase as a question about the goal.
- Reactions are not answers. If a decision is needed, ask for a written reply.
- Time zones: write "by 15:00 UTC" or the reader's local time, not "end of day".
- Edited messages do not re-notify. If a correction matters, post a new message.
- Pasting a screenshot of text blocks search and screen readers. Paste the text, and add the image only if the layout matters.
- Direct criticism in a public channel lands as shaming. Move it to a DM or a call.
- Replies late at night or at weekends set expectations for the sender too. Suggest scheduled send where the app has it.

## Output

The message in a code block or plain text, ready to paste, followed by one line of suggested thread text if details were split off. If a rewrite, show the new version only. No explanation of the changes.

For a request to several people, give one message with each name and task on its own line, not several messages.
