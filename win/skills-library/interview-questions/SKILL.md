---
name: interview-questions
description: Prepares open, researched interview questions for an expert, customer or subject, ordered to build from easy to hard with follow-ups and a list of facts to verify, so the conversation produces material the user can use. Use when the user asks for interview questions, prepares to interview a person, or asks what to ask a source.
---

# Interview questions

## Goal

A conversation that yields specific, quotable answers. A good question list is built from research on the person, starts easy, asks open questions about experiences and reasons, has follow-ups ready, and leaves room to follow what the person says.

## When to use

- The user will interview an expert, customer, candidate for a feature, or a witness to an event.
- The purpose is a story, article, research, case study or podcast.
- For the written case study afterwards, use `use_skill` with `case-study`.
- For structuring the resulting piece, use `use_skill` with `outline-builder`.
- Job interviews for hiring are a different task; ask the user which they need.

## Steps

1. Pin the purpose with `ask_user`: what the output is, who the audience is, how long the interview runs, the format (call, in person, written) and what the user most needs to learn or quote.
2. Research the person. Use `search_web` and `read_url` for their public work, talks, articles and role. Note facts to verify rather than assume. Read any material the user supplies with `read_file`. Stop when you know enough to avoid asking what is already public.
3. List what the user needs to come away with: five or six facts, stories or opinions. Every question should serve one of these.
4. Draft questions in groups. Start with an easy, answerable opening about their role or path. Move to the core topics. Put the hard or sensitive questions in the middle or later, after trust is built, and end with an open one ("What should I have asked?").
5. Write questions to open the answer: begin with how, why, what or "tell me about the time". Avoid yes or no questions, stacked questions with two parts, and questions that include the answer you want.
6. Add follow-ups under each key question: "What happened next?", "Can you give an example?", "How did you know?", "What did that cost?". Prepare a few probing lines for vague answers.
7. Order by flow, not by the order of your notes. Mark must-ask questions and nice-to-have ones so you can drop the rest if time runs short.
8. Add a list of facts to verify before or after, with the source to check, and any sensitive points that need care, such as consent for recording and off-the-record rules.
9. Save with `create_file` if wanted. Offer a one-line opening statement that explains the purpose and the use of the material.
10. Rehearse the first three questions aloud for wording and timing, and trim any that take over a minute to ask.
11. After the interview, plan the thank-you and the fact-check follow-up, and note what you promised to send.

## Gotchas

- Questions the research already answers waste the person's time and make the interviewer look unprepared. Use research to go deeper.
- Leading questions get agreement, not insight. Ask for the account, then probe.
- A long script read in order kills the conversation. Treat it as a map: follow a strong answer even if it leaves the list.
- Quoting someone needs consent rules clear before you start: recorded or not, on or off the record, whether they see the text.
- Sensitive topics asked cold produce shutdown. Build to them, and let the person decline.
- Do not invent details about the person to sound informed. Say only what the sources show.
- Silence is a tool. Wait after an answer; people often add the best detail when no one speaks.
- Written interviews lose follow-ups. Make each question complete and ask for examples in the question itself.
- Interviewing through an interpreter doubles the time. Cut the list to the questions that matter most.
- Do not use the interview to confirm a conclusion already written. Ask what would show you are wrong.
- Record the date and the exact words of anything said off the record, per the agreement made at the start.

## Output

- A one-sentence purpose and the list of things to learn.
- Question groups in order, each with follow-ups, must-asks marked.
- Facts to verify with sources, and logistics notes on recording and consent.
- The research notes you used, each with its source link.
