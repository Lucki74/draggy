---
name: audio-cleanup-plan
description: Diagnoses problems in a speech recording and gives an ordered cleanup chain with a check after each step, avoiding the over-processing that adds artifacts. Use when the user asks to clean up audio, remove background noise, or says a recording sounds bad.
---

# Audio cleanup plan

## Goal

Find what is actually wrong with a recording and fix it in an order that does not make things worse. The user gets a short chain of steps they can run in their editor or with command line tools, with a listening check after each.

## When to use

- A voice recording has noise, hum, echo, harsh sibilance, clipping or uneven levels.
- The user asks what order to apply effects in.
- For ready-made command line conversions, use `use_skill` with `ffmpeg-recipes`. For music or sound design choices, use `use_skill` with `music-brief`.

## Steps

1. Ask with `ask_user` for the source (mic, phone, call recording), the use (podcast, video, meeting), the editor or tools available and what bothers them most. Ask for a short problem sample if possible.
2. Inspect the file with `run_command` (for example `ffprobe` and, if installed, ffmpeg's `volumedetect` or `astats` filters; check the filter names with `ffmpeg -filters` first). Note the sample rate, channels, peak level, average level and signs of clipping.
3. Name the problems from what the numbers and user say: constant noise (hiss, fan), tone (mains hum with harmonics), room echo, plosives, sibilance, level swings, clipping, silent gaps with noise. Mark each as fixable, reducible or not fixable.
4. Order the chain: edit out mistakes and long pauses first, then repair clipping if possible, then remove hum with a narrow notch, then reduce broadband noise gently, then de-ess and tame plosives, then add gentle EQ, then compress lightly to even levels, then normalise loudness to the target, last. Explain why the order matters.
5. Look up the loudness target for the destination with `search_web` or `read_url` (platform and podcast guidelines vary and change). Do not quote a number from memory.
6. For each step give a starting setting range, the control that matters most, and a check: "Listen to the pauses; if the breaths sound watery, back off the reduction."
7. If the user wants a scripted chain, build it with ffmpeg filters, test on a 30 second slice with `run_command`, and keep the original untouched.
8. Save the plan with `create_file` as `audio-cleanup-plan.md` if it is long.
9. Compare the processed file with the original in level-matched A/B listening. A louder version always sounds better, so match levels before judging.

## Gotchas

- Strong noise reduction makes a voice sound underwater. Lower amounts at two passes beat one heavy pass.
- Normalising before editing makes loud mistakes set the level. Normalise last.
- Clipped audio cannot be restored fully. Say so, and recommend re-recording for important material.
- Judging on laptop speakers hides low-frequency problems. Check with headphones.
- Room echo from a hard room is the hardest to remove. Better mic placement beats any plug-in.
- Gating or expanding that closes between words chops breaths and word endings. Prefer gentle reduction.
- AI-based denoisers can invent speech-like sounds in silence. Listen to the quiet parts closely.
- Exporting to a lossy format between steps stacks losses. Keep a lossless working file.

## Output

- The A/B listening result and the final peak and loudness readings.
- A problem list with severity and a fixable rating.
- An ordered chain with settings to try and a listening check for each step.
- The loudness target and where it was found.
