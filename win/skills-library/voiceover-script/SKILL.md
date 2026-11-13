---
name: voiceover-script
description: Writes or adapts narration for voiceover with breath-sized sentences, pronunciation notes, pacing marks and a timing check against the picture. Use when the user asks for a voiceover script, narration for a video, or to make text sound spoken.
---

# Voiceover script

## Goal

Create narration that a speaker can record in few takes and that fits the picture. Each sentence is easy to say, tricky words are marked, and the timing matches the visuals.

## When to use

- The user has footage, a storyboard or an article and needs narration.
- Existing text was written for reading and sounds stiff when spoken.
- For a full video with hook and structure, use `use_skill` with `video-script`. For a demo of software, use `use_skill` with `screen-recording-script`.

## Steps

1. Ask with `ask_user` for the audience, the narrator (the user, a colleague, a voice actor, a text-to-speech tool), the tone, the length of each visual section, and any words that must be said exactly (legal lines, product names).
2. Read the visuals plan or source with `read_file`. List what the picture already shows, so the voice adds meaning instead of describing the picture.
3. Draft each section to a time budget. A speaking pace varies, so ask for a sample of the narrator's reading and count words per minute from it with `run_command`; use that for budgets.
4. Write for the ear: sentences that fit one breath, plain verbs, contractions, one idea per sentence, numbers rounded or spelled so they are easy to say, no stacked clauses, no jargon the audience does not know.
5. Mark pronunciation with a respelling for names, acronyms and foreign words, and say whether an acronym is spelled out or read as a word. Mark pauses with a slash or a line break, and emphasis with capital letters used sparingly.
6. Read the draft aloud in your head and mark any phrase with a tongue-twister run of similar sounds, ending sounds that collide with the next word, or a rhythm that repeats too long.
7. Time each section against the picture length with `run_command`. If a section runs over, cut words, not speed. If under, let the picture breathe.
8. Save with `create_file` as `voiceover.md`, with one block per picture segment and its target duration. If a text-to-speech tool will voice it, test the pronunciation marks in a sample.
9. Provide a recording note for the session: room, mic distance, a test sentence, and a request to record each section twice with a short gap between them.

## Gotchas

- Writing out every number and symbol as the speaker would say it avoids misreads, such as "3.5" or "2024" being read in the wrong way.
- A voice that restates the picture feels redundant. Say what the image cannot show.
- Rewriting after recording changes the timing. Lock the script before the session.
- Text-to-speech tools handle punctuation differently. Test a paragraph before producing everything.
- Dense information in a 20 second section cannot be absorbed. Split it or put the detail on screen.
- Voice actors need usage rights stated in writing. Ask for a short agreement, not a handshake.
- Cloning a real person's voice with a tool needs that person's consent. Do not suggest it otherwise.
- Alternate versions for different lengths are cheap to record together and costly to add later.

## Output

- The recording note for the session.
- `voiceover.md` with segment, text, duration and pronunciation notes.
- Total runtime and the pace used.
- A list of words to check with the narrator.
