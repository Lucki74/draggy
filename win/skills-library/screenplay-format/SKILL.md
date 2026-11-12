---
name: screenplay-format
description: Converts prose or notes into correctly formatted screenplay pages with sluglines, action lines, character cues, dialogue and transitions, written so only what a camera can show appears. Use when the user says "format this as a screenplay", "write a script scene" or "turn my story into a screenplay".
---

# Screenplay format

## Goal

Produce pages a reader in film or TV recognizes as a script. A good result uses the standard layout, shows events through image and sound, keeps action blocks short and gives each speaker a distinct voice.

## When to use

- The user has a story, scene or outline and wants it in script form.
- A script draft has formatting errors or reads like a novel.
- The user wants a short film scene for class, a contest or a pitch.

For prose scenes, use `scene-writer`. For polishing the talk only, use `dialogue-polish`. For the plot plan, use `plot-outline`.

## Steps

1. **Read the source.** Call `read_file` if it is a file. Ask with `ask_user` for the medium (short film, feature, TV, stage), the page limit and any required style, such as a contest's format rules. If a contest or school gives rules, follow those over the default.
2. **List the scenes.** Break the source into scenes by place and time. Each gets a one-line purpose.
3. **Write sluglines.** Format: INT. or EXT., place, dash, time of day, in capitals. Example: INT. KITCHEN - NIGHT. Keep place names consistent across scenes.
4. **Write action lines.** Present tense, third person, only what can be seen or heard. Three or four lines per block at most. Start a new block for a new image.
5. **Convert thoughts to behavior.** Where the source says "she felt trapped", find a visible act: she tries the door twice. If nothing visible works, use a short line of dialogue or a prop.
6. **Format dialogue.** Character name in capitals above the speech, parentheticals only when the delivery is not obvious, and sparingly. Introduce each character in capitals the first time they appear in action.
7. **Cut for speech.** Trim dialogue so each line is playable. Use interruptions and silence. Mark pauses with action, not with a row of dots.
8. **Add transitions only when needed.** CUT TO is rarely required. Use it for a real jump or a match.
9. **Check page length.** One page runs roughly one minute on screen under standard format. Use `run_command` to count lines or words if a limit exists.
10. **Output in the right layout.** If the user needs a file, call `create_file` with plain text using consistent indentation, or Fountain syntax if requested. Say which one.
11. **Check the scene heads in order.** List the sluglines in sequence and confirm each place and time follows logically and nothing jumps without reason.
12. **Read the action lines aloud.** Cut any that a viewer could not see or hear on screen, and any longer than four lines.

## Gotchas

- Camera directions and music cues in every line mark an amateur script. Use them only when the story depends on one.
- Describing what a character thinks or what the audience cannot see breaks the form. Write what the camera records.
- Long blocks of action hide the pace. Break them up.
- Characters named in the action but never introduced in capitals confuse readers. Capitalize on first appearance only.
- Industry layout details (margins, fonts, page counts) vary by market. For a submission, check the recipient's guidelines with `read_url` before final output.
- Dual dialogue and complex layouts are hard in plain text. Offer Fountain or a script-software export for those.
- Scripts adapted from prose usually run too long. Expect to cut a third of the dialogue.
- Mentioning actors or music tracks by name in the script is a habit to avoid unless the contest asks for it.

## Output

The formatted script pages in a code block so the spacing holds, or saved with `create_file`. Above the pages, nothing. Below them, up to four lines on cuts made, visuals invented to replace thoughts, and anything the user must decide.

If the script is long, deliver it in scene batches and ask the user to confirm the format before continuing.
