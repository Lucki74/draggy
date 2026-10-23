---
name: video-edit-plan
description: Turns footage notes and a goal into an ordered edit plan covering assembly, story cuts, pacing, audio, graphics, color and export, so editing starts with structure and not effects. Use when the user asks how to cut a video, wants an edit plan, or does not know where to start with their footage.
---

# Video edit plan

## Goal

Give the editor a sequence of passes, each with a clear target, so the cut improves step by step and nothing polishable is polished before the structure is right. The plan also names the decisions that need the user.

## When to use

- The user has raw footage and a goal and wants to know how to approach the edit.
- A rough cut feels slow or confusing and needs a diagnosis.
- For commands that cut or convert files, use `use_skill` with `ffmpeg-recipes`. For the footage logistics before the shoot, use `use_skill` with `shot-list`.

## Steps

1. Ask with `ask_user` for the goal and length, the audience, the platform, the editing software, how much footage there is and whether a script or storyboard exists. Read them with `read_file` if so.
2. Take stock of the footage. Use `list_directory` to see the files, and `run_command` with `ffprobe` to read durations and formats if installed. Flag mixed frame rates, resolutions or audio setups, since they cause problems at export.
3. Plan the organisation pass: copy to a project folder, rename by scene and take, create bins, mark the best takes. Keep the originals untouched and a backup in a second place.
4. Plan the assembly pass: lay the best takes in story order with no trimming finesse. Judge only whether the story works. Cut anything that does not move it.
5. Plan the tightening pass: remove dead air, repeats and weak lines. Set the pacing, with shorter shots where energy is wanted and longer where the viewer needs to feel something. Check the first fifteen seconds with fresh eyes.
6. Plan the sound pass before the look pass: dialogue clean-up and levels, music under speech, effects, room tone to fill gaps. Use `use_skill` with `audio-cleanup-plan` for problem recordings.
7. Plan the picture pass: stabilise only what needs it, correct exposure and white balance first, then grade for mood, then add titles, lower thirds and graphics in one consistent style.
8. Plan review and export: watch on a phone and with the sound off, list notes, make the changes in one batch, then export with the settings the platform recommends (check the current upload guide with `read_url`). Save the plan with `create_file` as `edit-plan.md`.
9. Version the project at each pass with a dated name, so the user can step back to the assembly if the tightening goes too far.

## Gotchas

- Adding music and effects before the structure is settled means redoing them after each cut.
- Keeping every good take makes the video long. Pick one and let the others go.
- Colour grading clips that have different exposure first hides problems instead of fixing them. Correct before grading.
- Review at the end only. Show a rough cut early to one person to catch story confusion.
- Different frame rates in one timeline can cause judder. Decide the project rate at the start.
- Jump cuts hide a lot of dead air but too many feel nervous. Vary the shot size to rest the eye.
- Captions need to be planned for in the layout. Keep important picture content out of their area.
- Proxy files speed editing on weak machines, but relink to the originals before the final export.

## Output

- A suggested file and version naming scheme.
- A numbered pass list with the goal, the checks and the time estimate for each.
- Decisions needed from the user, with a suggested default.
- Export settings to confirm and the source link for them.
