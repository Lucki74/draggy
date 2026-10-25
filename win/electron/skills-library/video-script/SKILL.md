---
name: video-script
description: Writes a spoken video script from a topic or notes, with a hook, ordered beats, visual cues, timing and a call to action. Use when the user asks for a video script, a script for a YouTube video, or to turn an article or notes into a video.
---

# Video script

## Goal

Produce a script that sounds natural aloud and tells the editor what to show. The first ten seconds earn the viewer's attention, each beat has one point, and the length fits the planned runtime.

## When to use

- The user has a topic, notes, an article or a rough idea and wants a script for a video.
- An existing script reads like an essay and needs to be made speakable.
- For narration only over existing footage, use `use_skill` with `voiceover-script`.
- For planning visuals shot by shot, continue with `use_skill` and `storyboard`.

## Steps

1. Ask with `ask_user` for the audience, the one thing a viewer should know or do afterwards, the target length, the platform, the speaker's voice (formal, casual, funny) and whether the speaker is on camera.
2. Read any source material with `read_file` or `read_url`. Pull out the claims, numbers and examples you may use. Do not add facts that are not in the source or checked.
3. Write the hook: a concrete promise, a surprising fact or a problem the viewer recognises, within the first sentence or two. Do not begin with a greeting or a channel intro.
4. List three to six beats. Each beat has a single point, one example or proof, and a line that leads into the next. Cut a beat that does not serve the one thing.
5. Draft in speech: short sentences, contractions, active verbs, numbers that are easy to say. Read each paragraph aloud in your head and break any sentence you cannot say in one breath.
6. Add visual cues in a second column or in brackets: on camera, screen capture, b-roll idea, graphic, on-screen text. Mark where a pattern interrupt such as a cut or a new angle helps.
7. Check length with `run_code`: count words and divide by a speaking rate the user confirms (people differ; ask for a sample of their usual pace). Trim or add to match the target.
8. End with one call to action only, and a closing line that restates the payoff. Save with `create_file` as `script.md`.
9. Hand the speaker a short delivery note: where to pause, which lines to stress, and which sections can be cut first if the recording runs long.

## Gotchas

- A script written for reading uses long clauses and stacked adjectives. Speak it aloud, then rewrite what trips you.
- Promising a payoff in the hook and delivering it at the end loses viewers. Give a small payoff in each beat.
- Statistics said aloud need rounding and a source. Put the exact figure on screen.
- Do not write jokes or catchphrases the speaker would never say. Match their sample.
- Several calls to action at the end cancel each other. Pick one.
- Teleprompter text needs larger line breaks than a page. Break lines at phrases, not at the margin.
- Reusing a competitor's script structure beat for beat reads as a copy. Take the technique, not the lines.
- Music, clips and screenshots named in the cues need rights. Flag those that are not the user's own.

## Output

- Delivery notes for the speaker, and a cut order for running long.
- `script.md` with a two-column table: spoken text and visual cue, with beat headings.
- Word count and estimated runtime, with the pace used.
- A list of claims that need a source or a check before recording.
