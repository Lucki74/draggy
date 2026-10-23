---
name: subtitle-timing
description: Splits text into readable subtitle cues with line length and duration rules, fixes bad timing in SRT or WebVTT files, and converts between the two formats. Use when the user asks to make subtitles, fix an SRT, or convert captions to VTT.
---

# Subtitle timing

## Goal

Produce a subtitle file that viewers can read comfortably and players accept. Cues are short enough to read, appear when the words are spoken, never overlap, and use the exact syntax of the target format.

## When to use

- The user has text and timestamps, or only text and an audio length, and needs a subtitle file.
- An existing SRT or VTT has overlaps, drift or cues too long to read.
- To get a transcript from audio first, use `use_skill` with `transcript-cleanup` after transcribing with the tools the user has. For burning subtitles into video, use `use_skill` with `ffmpeg-recipes`.

## Steps

1. Read the file with `read_file`. Identify the format: SRT has a number line and `00:00:01,000 --> 00:00:03,000` with a comma; WebVTT starts with `WEBVTT` and uses a period before milliseconds. Ask with `ask_user` for the target format, language and any platform rule (some platforms publish their own limits; check the platform's help page with `read_url` or `search_web`).
2. Parse the cues with `run_code` and list problems: overlaps, start after end, negative or missing times, gaps under a few frames, cue numbering gaps, blank cues and encoding issues. Report counts before changing anything.
3. Set reading rules with the user, and use common defaults if they have none: at most two lines per cue, about 35 to 42 characters per line, a reading speed near 17 characters per second, a minimum duration around one second and a maximum around six or seven.
4. Split long cues at natural breaks: sentence ends, then clauses, then before conjunctions. Do not split inside names, numbers with units, or a verb and its particle. Divide the time in proportion to character counts, and keep every cue inside the original span.
5. Where timing is missing, estimate from audio length and word count, and label the file as estimated. Offer to align it later with a forced-alignment tool the user has.
6. Fix drift with a constant offset or a linear stretch only if two reference points (first and last spoken line) are known from the user.
7. Write the result with `create_file`, using the target syntax. Re-parse the new file with `run_code` to confirm zero overlaps and monotonic times.
8. Add speaker or sound labels only if the user asked, in the style of the format such as `[music]` or `<v Name>` for VTT voice tags.
9. Test the file in the player or platform it is meant for, or ask the user to, and watch two minutes at the start and at the end for drift.

## Gotchas

- Wrong decimal separator is the commonest reason a player rejects a converted file.
- Adjacent cues that end and start on the same millisecond flicker on some players. Leave a small gap.
- Right-to-left languages and some scripts need different line breaking. Do not apply English length rules blindly.
- Files with a byte order mark or Windows line endings can break strict parsers. Keep the encoding of the source unless told otherwise.
- Hard-coded styling tags differ between formats. Remove tags the target does not support.
- Frame rate conversions change timing when the source uses frame-based timecodes. Ask for the rate.
- Burned-in subtitles cannot be turned off or translated later. Offer a separate file when possible.
- Subtitles for deaf and hard of hearing viewers need sound cues. Plain dialogue subtitles do not.

## Output

- The playback test result, or a note that it was not tested.
- The file path of the new subtitles and its format.
- Before and after counts of problems.
- A note on anything estimated or left for a human check.
