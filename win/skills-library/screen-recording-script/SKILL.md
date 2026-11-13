---
name: screen-recording-script
description: Plans a screen-recorded demo or tutorial with prepared app state, a click-by-click path, short narration, cut points and checks for private data on screen. Use when the user asks to script a screen recording, plan a software demo, or record a tutorial.
---

# Screen recording script

## Goal

Make a recording that shows one task clearly, without mistakes, retakes of the setup or private data on screen. The user gets a prepared state, a path through the app with narration, and a checklist to run before recording.

## When to use

- The user will record a product demo, a how-to or a bug report video.
- The user has a rambling recording attempt and wants a plan for a clean one.
- For narration that goes over the footage, use `use_skill` with `voiceover-script`. For turning the result into captions, use `use_skill` with `subtitle-timing`.

## Steps

1. Ask with `ask_user` for the audience and their skill level, the one task the video teaches, the length target, the app and version, and where it will be shown. Ask if a written guide exists, and read it with `read_file`.
2. Define the outcome as a sentence: "After this video, the viewer can export a report as PDF." If the video has two outcomes, plan two videos.
3. Walk the path yourself or with the user and write each step as an action and a result: "Click Export, choose PDF, see the file saved". Check the real labels in the app so the script matches the interface. Use `browser_navigate` and `browser_snapshot` if it is a web app you may access, otherwise ask the user to confirm the labels.
4. Write the narration for each step in short lines that say why, not what: "Choose PDF because it keeps the layout". The cursor already shows the click. Keep the intro to one sentence and the ending to the result and the next step.
5. Prepare the app state: a clean demo account or sample data, a fresh profile with no personal bookmarks, notifications off, a tidy desktop, a consistent window size at the target resolution, a large cursor and font size if the video will be viewed small.
6. Check for private content: names, emails, tokens, addresses, tabs, file paths and notification previews. Use fake data. Never type real passwords or keys in front of the recording.
7. Mark cut points: where to pause for a loading step, which sections to speed up, and which mistakes can be fixed by cutting. Add on-screen callouts for the click targets that are small.
8. Save the script with `create_file` as `recording-script.md`, with a pre-flight checklist at the top.
9. Do one dry run without recording to time the path, then record in short takes per step so a slip costs seconds, not the whole video.

## Gotchas

- Narrating every click wastes the viewer's time and hides the reasoning. Explain choices.
- A real account on screen is a leak waiting to be published. Review the whole footage at normal speed before sharing.
- UI changes between app versions make a video obsolete. Note the version and plan updates.
- Moving the mouse constantly makes viewers lose the point. Move deliberately and pause on the target.
- Long loading waits should be cut or sped up in the edit, not narrated over.
- Recording at a high resolution makes text tiny after upload. Zoom in on small controls in the edit.
- Keyboard shortcuts happen off screen. Show them as an overlay or say them.
- Audio recorded at the same time as the screen picks up keyboard noise. Record narration separately if clean sound matters.

## Output

- A list of shortcuts or overlays to add in the edit.
- `recording-script.md` with outcome, pre-flight checklist, step table with narration and cut notes.
- The app version and screen settings used.
- A list of private data checks run.
