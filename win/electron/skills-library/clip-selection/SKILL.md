---
name: clip-selection
description: Finds self-contained moments in a long transcript worth cutting as short clips, with exact start and end points, a working title for each and a reason it stands alone. Use when the user asks to find clips, pick shorts or highlights, or choose the best moments from a recording.
---

# Clip selection

## Goal

Select a handful of moments that work as stand-alone short videos or audio clips. Each has a clear start, a payoff and an end, with timestamps accurate enough for an editor to cut.

## When to use

- The user has a timed transcript of a long video, podcast, talk or meeting.
- The user wants social clips, teasers or highlights from it.
- For cutting the clips with commands, use `use_skill` with `ffmpeg-recipes`. For planning the full edit, use `use_skill` with `video-edit-plan`.

## Steps

1. Read the transcript with `read_file`. Confirm it has timestamps. Without them, ask for a timed version, since picking clips without times is only a rough list. Ask with `ask_user` for the platform, the clip length range, the audience and what the clips should achieve (reach, sign-ups, teasing the full episode).
2. Read the whole transcript once before choosing. Note the topic changes, stories, strong claims, surprising facts, practical tips, laughter and emotional peaks.
3. Shortlist candidates. A good clip answers a question, tells a story with an ending, gives a tip with a reason, or states a sharp opinion. It makes sense to someone who has not seen the rest.
4. Set the cut points. Start a sentence or two before the key line to give context, but not earlier than needed. End on the payoff or the natural pause. Never cut mid-sentence. Use `run_code` to compute the duration from timestamps and drop candidates outside the length range.
5. Check each clip alone: read it as if you knew nothing else. Mark references that need earlier context ("as I said before", unexplained names) and either move the start earlier or drop the clip.
6. Rank by standalone value, not by the speaker's energy. Pick the top five to ten, mixing types so they are not all the same kind of moment.
7. For each clip write: working title, start and end times, duration, one-line reason, any on-screen text idea, and a caption suggestion. Keep the speaker's actual words when you quote.
8. Save with `create_file` as `clips.md` as a table. Mention that timestamps may need a small adjustment after listening.
9. For vertical clips, note where the speaker sits in the frame so the crop keeps them in view, and whether on-screen text needs moving.

## Gotchas

- Timestamps in auto transcripts can be off by a second or two. Add a small margin and tell the editor to check by ear.
- A clip cut at the exact start of a word can clip the first sound. Start slightly earlier.
- Quotes taken out of context can change meaning. Check that the clip does not misrepresent the speaker, especially on claims.
- Several clips that make the same point add little. Choose the best version.
- Guests may need to approve clips. Ask whether permission is required.
- Clips begin to be judged in the first two seconds. Open on the strongest sentence when the context allows.
- A clip that relies on a visual from the full video, such as a slide, may need a caption or a graphic.
- Do not stitch separate moments together to build a quote the speaker never said in one go.

## Output

- Crop and caption notes for vertical use.
- A ranked table: title, start, end, duration, reason, caption idea.
- Candidates dropped and why, in one line each.
- A reminder to verify cut points by listening.
