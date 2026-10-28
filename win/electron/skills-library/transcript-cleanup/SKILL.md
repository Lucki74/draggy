---
name: transcript-cleanup
description: Cleans a raw speech-to-text transcript by fixing punctuation, speaker labels, fillers and obvious recognition errors while keeping the speaker's meaning and every flagged uncertainty. Use when the user asks to clean up a transcript, fix a transcript, or remove ums and repeats.
---

# Transcript cleanup

## Goal

Turn a raw machine transcript into readable text without changing what was said. The result is faithful to the speakers, with every guess about a name, number or unclear phrase marked for the user.

## When to use

- The user has an automatic transcript of a meeting, interview, lecture or video.
- The user wants fillers removed, speakers labelled or paragraphs added.
- For notes on a meeting rather than a transcript, use `use_skill` with `meeting-notes`. For show notes, use `use_skill` with `show-notes`.

## Steps

1. Ask with `ask_user` which style is wanted: verbatim (keep fillers and false starts), light clean (remove ums, stutters, repeated words) or full edit (tighten and join sentences). Default to light clean. Ask whether timestamps stay.
2. Read the file with `read_file` and note the format: plain text, SRT, VTT or a speaker-tagged export. Copy the original to a new name with `run_command` so the source stays intact; work on the copy.
3. Build a glossary first. Collect proper nouns, product names, acronyms and jargon the user gives, and search the transcript with `search_files` for likely mis-hearings of each (sound-alikes). Ask the user to confirm the ones you are unsure about.
4. Fix speaker labels. Identify the speakers from names said in the text or from the user, and keep one label per person across the file. If a turn is unclear, mark `[speaker?]`.
5. Fix mechanics: sentence breaks, capitalisation, punctuation, paragraphs at topic changes. Remove fillers only if the chosen style says so.
6. Handle numbers, dates and names with care. Change them only when the context makes the correction certain; otherwise keep the original and add a bracketed flag like `[check: 15 or 50?]`.
7. Mark inaudible or doubtful passages as `[inaudible]` or `[unclear: best guess]` instead of filling the gap with a plausible sentence.
8. Edit the copy with `edit_file` or write a new one with `create_file`. Compare lengths: a light clean should remove well under a fifth of the words. Check with `run_command` and review any large drop.
9. Spot check five passages against the audio or the original text, chosen at random and including at least one with numbers, and report any difference found.

## Gotchas

- Smoothing grammar can change meaning, especially hedges ("I think we might") and negations. Keep them.
- Removing a filler like "like" is wrong when it is the content of the sentence.
- Speaker swaps are the most damaging error in a transcript used as a record. Check each turn at topic changes.
- Do not translate or correct a speaker's dialect or accent into standard spelling unless the user asks.
- Timestamps shift when lines are merged. Keep the start time of the first merged line.
- A transcript used as evidence or minutes should stay verbatim apart from obvious typos. Ask before cleaning more.
- Laughter, crosstalk and pauses carry meaning in some contexts. Keep them as bracketed notes when relevant.
- Names of people who asked not to be identified must stay as the user instructs, not as the audio says.

## Output

- The result of the spot check.
- The cleaned file path and the style used.
- A list of flags: names, numbers and unclear passages awaiting confirmation.
- Word counts before and after.
