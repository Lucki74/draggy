---
name: ffmpeg-recipes
description: Builds ffmpeg commands for common jobs such as trimming, converting, extracting audio, resizing and burning subtitles, checking the installed version and flags first and never overwriting the source. Use when the user asks for an ffmpeg command, to convert or trim a video, or to extract audio.
---

# ffmpeg recipes

## Goal

Give a working command for the user's exact task and run it safely if asked. Flags are checked against the installed ffmpeg, the source file is never overwritten, and the output is inspected after it is made.

## When to use

- The user wants to cut, join, convert, compress, resize, extract or replace media streams.
- A command copied from a forum fails or gives poor quality.
- For editing decisions rather than commands, use `use_skill` with `video-edit-plan`. For audio problems, use `use_skill` with `audio-cleanup-plan`.

## Steps

1. Ask with `ask_user` for the input file, the wanted result (format, size, resolution, length) and the purpose, such as web upload, archive or sharing in a chat app.
2. Check the tool is present: run `ffmpeg -version` with `run_command`. If it is missing, say so and point to the official download page. Check exact options with `ffmpeg -h`, `ffmpeg -h full` or a specific `ffmpeg -h encoder=NAME`. For anything unclear, read the live documentation page for the installed version with `read_url`. Do not rely on memory for flags, since options change.
3. Inspect the input with `ffprobe` through `run_command`: list streams, codecs, duration, frame rate, resolution and channel layout. The right command depends on these facts.
4. Choose the least destructive approach. If only the container or a cut is needed and the cut points are on keyframes, stream copy avoids re-encoding. If filters or a different codec are needed, re-encode with a quality setting, not a fixed bitrate guess.
5. Write the command with the input first and an explicit output name that differs from the input. Keep paths with spaces quoted. Use the no-overwrite behaviour (do not pass the force flag) so an existing file is not replaced silently.
6. Show the command to the user with a one-line explanation of each non-obvious flag and ask before running anything that takes long or writes many files.
7. Run it with `run_command`. Then run `ffprobe` on the output to confirm duration, streams and size. Play-check details the user cares about, such as audio sync at the cut point.
8. For batch jobs, loop over files in a script saved with `create_file` and dry-run it by printing the commands first.
9. If the command fails, read the last lines of the error output in full before changing anything. The message usually names the stream, filter or option at fault.

## Gotchas

- Putting the seek option before or after the input changes speed and accuracy. Check the current docs for the behaviour you need.
- Stream copy cuts only on keyframes and can leave a frozen start. Re-encode for frame-accurate cuts.
- Many players need a specific pixel format and even dimensions for H.264. A resize to an odd width fails or plays badly.
- Mapping is not automatic when a file has several audio or subtitle streams. State which ones to keep.
- Filter chains on Windows shells need different quoting than on Unix shells. Test quoting with the exact shell in use.
- Builds differ. A codec or filter that works on one machine can be absent from another build. Check `ffmpeg -encoders` and `-filters`.
- Variable frame rate phone footage can lose audio sync after trimming. Check sync, and set a constant rate if needed.
- Quality settings are not comparable across codecs. Judge by looking at the result, not by the number.

## Output

- The ffmpeg version string used for the command.
- The final command in a code block and what each flag does.
- Input and output facts from `ffprobe`, side by side.
- Any quality or compatibility trade-off the user should know.
