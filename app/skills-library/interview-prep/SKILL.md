---
name: interview-prep
description: Builds a prep plan for one specific interview from the posting, the company and the user's background, with likely questions, stories to ready and questions to ask. Use when the user has an interview coming up, asks what they will be asked, or wants help preparing for a job interview.
---

# Interview prep

## Goal

Get the user ready for a particular interview in the time they have. The plan covers what the employer likely cares about, which experiences to bring forward, how to answer the hard questions honestly, and what to ask in return.

## When to use

- An interview is scheduled and the user has the posting or the role name.
- The user wants a mock interview or practice questions.
- Turning a memory into an answer is `use_skill` with `star-story-builder`.

## Steps

1. Ask with `ask_user` for the role, the company, the interview format and length, who will interview, and the date. Read the posting and the user's resume with `read_file`.
2. Research the employer with `read_url` on its site and `search_web` for recent news. Note the date of each source and keep facts the user can verify.
3. Look up the interviewers if the user gives names. Use only public professional information, and stop at what is relevant to the conversation.
4. List what the role needs, in the posting's own words, and map each need to a real experience of the user. Mark the needs with no matching experience.
5. Write the likely questions in four groups: about the user, about the role, behavioural, and the awkward ones such as gaps, leaving a job or pay.
6. For each group, outline the points of an answer, not a script. For awkward questions, help the user find a short, honest, forward-looking answer.
7. Choose four or five stories that cover the most needs. Check them with `use_skill` and `star-story-builder` if they are not ready.
8. Write six questions for the user to ask, tied to the role and the research. Remove anything the website already answers.
9. Plan the logistics: time, place or link, tests of audio and camera, documents, and the first five minutes.
10. Offer a practice round: ask questions one at a time, wait for the answer and give two specific notes.
11. End with a one-page cheat sheet of the key points, names and numbers the user can glance at before the call.
12. Send a short thank-you note within a day, and record what was asked while it is fresh.

## Gotchas

- Memorizing full answers. They sound stiff and fall apart on a follow-up.
- Researching the company but not the person who will interview.
- Practising only the easy questions. The awkward ones decide how the day feels.
- Leaving pay for the end without a plan. Ask when the topic will come up.
- Asking no questions at the end, which reads as low interest.
- Stating company facts from memory instead of checking the current source.
- Ignoring the first impression: late arrival, a poor connection or an unprepared space.
- Skipping the debrief notes, which would help the next interview.

## Output

A prep sheet with the employer summary, the match table, question groups with answer points, the chosen stories, questions to ask and the logistics checklist.
