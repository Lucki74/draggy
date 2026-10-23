---
name: interview-question-flow
description: Designs an ordered flow of open questions with follow-ups, a safe opening and planned transitions for a recorded interview with a guest. Use when the user asks for interview questions, to plan a podcast interview, or how to structure a conversation with a guest.
---

# Interview question flow

## Goal

Prepare a conversation that gets stories and specifics instead of short answers. The user gets questions in an order that builds trust, with follow-ups ready and room to follow what the guest says.

## When to use

- The user will interview a guest for a podcast, video, article or research.
- The user has a guest and a topic but does not know where to start.
- For the episode structure around the interview, use `use_skill` with `podcast-outline`. Job interviews are a different task, so leave those to the hiring skills.

## Steps

1. Ask with `ask_user` for the guest, the purpose of the interview, the audience, the length, whether it is live or edited, and what the guest has agreed to discuss. Ask whether any topic is off limits.
2. Research the guest from sources the user supplies or from `search_web` and `read_url`. Collect public facts: work, past interviews, writing. Note what has been asked many times already, to avoid it. Do not include private or unverified personal details.
3. Define the three things the audience should take away. Every question serves one of them or is a deliberate warm-up.
4. Draft an opening that is easy and specific, such as "How did you start on this?" rather than a request for a life summary. Then build a middle in themed blocks, moving from story to opinion to practical advice. Put sensitive topics after trust is built, and say so to the guest in advance if needed.
5. Write questions as open prompts: "Walk me through...", "What did you expect, and what happened?", "What would you do differently?". Avoid questions that can be answered yes or no, and avoid stacking two questions in one.
6. Add one or two follow-ups per block: "Can you give an example?", "What did that look like day to day?", "Why that choice?". Plan a silence: wait a few seconds after an answer before moving on.
7. Close with a question that lets the guest add anything missed, and a practical ending such as where to find their work. Mark which questions to drop if time is short.
8. Save with `create_file` as `interview-flow.md`, with a short pre-interview checklist for consent to record, audio test and a note to the guest about the topics.
9. Prepare two pivot questions for when an answer is short or off track, such as asking for a concrete moment or a number.

## Gotchas

- Reading questions in order makes the interview stiff. Treat the list as a map and follow the guest's best thread.
- Leading questions put words in the guest's mouth. Keep them neutral.
- A guest's recent news may change what is relevant. Check on the day of recording.
- Do not surprise a guest with hostile material unless the format is an accountability interview and they know it.
- Long preambles in your questions take the guest's time. Keep each under two sentences.
- Sending every question in advance gives rehearsed answers. Share the topics and keep the exact wording.
- Interrupting to show knowledge cuts the guest off. Wait for the end of the thought.
- Facts you plan to state on air about the guest need a source you can name.

## Output

- Two pivot questions for short answers.
- `interview-flow.md` with blocks, questions, follow-ups and the drop list.
- The three takeaways the flow serves.
- Facts about the guest that need verification before use.
