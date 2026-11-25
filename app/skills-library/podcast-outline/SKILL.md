---
name: podcast-outline
description: Plans a podcast episode with a cold open, titled segments, talking points, transitions, timing and a closing takeaway, sized to the show's format. Use when the user asks to outline a podcast episode, plan a show, or structure what to say.
---

# Podcast outline

## Goal

Give the host a structure loose enough to sound natural and tight enough to avoid rambling. The outline has timing per segment, a reason for each segment to exist, and a clear ending.

## When to use

- The user is preparing a solo, co-hosted or panel episode.
- The user has a topic and a pile of notes and cannot see the order.
- For interview shows, use `use_skill` with `interview-question-flow`. For the written summary after recording, use `use_skill` with `show-notes`.

## Steps

1. Ask with `ask_user` for the show's format (solo, co-host, interview, panel), the usual length, the audience and what they gain from an episode, and anything the show always includes such as an intro, sponsor read or listener question.
2. Define the episode's single question or promise in one sentence: "By the end, listeners will know how to X." If the notes support two episodes, say so and split.
3. Read notes or sources with `read_file` or `read_url`. Group points into three to five segments, each with one main idea, one story or example and one takeaway.
4. Write the cold open: a hook of 15 to 45 seconds that states the stakes or tells a vivid moment before any intro music or housekeeping.
5. Set the segment order from broad context to specific detail, or from problem to solution. Place the strongest material early and the most complex material when the audience is settled.
6. Assign timing to each segment and sum it with `run_command` against the target length. Add a buffer of 10 to 15 percent for tangents. Mark the segments that can be cut if time runs short.
7. Write transitions: one sentence that connects each segment to the next, and a closing that restates the takeaway and names one action.
8. Save with `create_file` as `episode-outline.md`, with talking points as bullets, not full sentences.
9. For a co-hosted show, assign who leads each segment and where they hand over, so both people speak and nobody guesses.

## Gotchas

- A full script makes a conversation sound read. Write bullets and key phrases, and script only the open and close.
- Housekeeping before the hook costs listeners. Move sponsor reads and announcements after the first segment unless the format forbids it.
- Real names, quotes and numbers must come from the source. Mark any you are unsure of with a check flag.
- Episodes drift long. Planning to the exact target length leaves no room for a good tangent.
- A takeaway that was never set up at the start feels bolted on. Check that the opening promise and the close match.
- Segments that depend on a listener's memory of last week need a one-line recap for new listeners.
- Reading ad copy in the middle of a story kills the mood. Place it at a natural break.
- Recording the outline's opening last, after the content is known, often gives a better hook.

## Output

- Handover notes for co-hosts, when the show has more than one voice.
- `episode-outline.md` with title options, cold open, timed segments and closing.
- A cut list for running long and an add list for running short.
- A short list of facts to verify before recording.
