---
name: storyboard
description: Breaks a script or idea into a shot-by-shot storyboard table with framing, action, dialogue or audio, duration and transitions, checked against total runtime. Use when the user asks to storyboard a video, plan shots visually, or turn a script into frames.
---

# Storyboard

## Goal

Make the visual plan of a video concrete before filming or animating. Each frame has a purpose, the sequence adds up to the target runtime, and the crew or editor can read it without asking questions.

## When to use

- The user has a script or a clear idea and needs the visual sequence.
- A shoot or animation needs agreement on what each shot shows.
- For writing the script first, use `use_skill` with `video-script`.
- For the practical shoot-day list of locations and gear, use `use_skill` with `shot-list`.

## Steps

1. Read the script with `read_file`, or ask with `ask_user` for the idea, the target length, aspect ratio (wide, vertical, square) and style (live action, screen capture, animation). Ask what must be shown versus what can be implied.
2. Split the script into scenes by location or time, then each scene into beats where the picture must change. A new idea or new information usually needs a new shot.
3. For every shot give: number, scene, shot size (wide, medium, close-up, insert), camera angle or movement, what happens, dialogue or voiceover line, sound or music note, estimated duration and the transition to the next shot (cut, dissolve, match cut).
4. Add the time: sum the durations with `run_code` and compare with the target. Trim shots that repeat information, or merge two shots into one wider shot.
5. Check continuity: screen direction stays consistent between shots, props and clothes stay the same inside a scene, and eyelines match. Note any rule the crew must follow.
6. Make a rough visual for each frame if the user asks: ASCII thumbnail boxes or a simple SVG per frame created with `create_file`. For stylised frames, use `generate_image` only as a rough reference and label it so.
7. Mark special requirements: graphics, text on screen, effects, permissions, safety, props.
8. Save the table with `create_file` as `storyboard.md` and ask the user to confirm the sequence before moving to shot planning.
9. Read the finished board in order as if it were the film and check that the story is clear with the sound off, then again with only sound. Both should make sense.

## Gotchas

- A shot that shows the same thing the narration says adds nothing. Show an example, a consequence or a different angle.
- Long static shots need a reason. Every second on screen must be earned by new information.
- Durations are estimates. Dialogue takes the time it takes, so time lines by reading them aloud.
- Do not storyboard camera moves the crew cannot do with the available gear.
- Switching between very different shot sizes without a bridge reads as a jump cut.
- Vertical and wide frames compose differently. Draw for the delivery ratio, not for a default.
- Text on screen needs time to be read. Allow at least as long as saying it aloud.
- Animation boards need holds and in-betweens noted, since motion cost depends on them.

## Output

- Notes on the sound-off and sound-only check.
- A table: shot, size and angle, action, audio, duration, transition.
- Total runtime against target, with the trims proposed.
- A list of open questions and special requirements.
