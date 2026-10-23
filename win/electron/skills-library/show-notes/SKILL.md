---
name: show-notes
description: Writes show notes for a podcast or video episode from its transcript or notes, with a summary, timestamped chapters, key takeaways and a links list that comes only from the source. Use when the user asks for show notes, episode timestamps, or a summary of an episode.
---

# Show notes

## Goal

Create notes that help people decide to listen and help listeners find what they want later. Every timestamp points to a real moment and every link or name comes from the source.

## When to use

- The user has a transcript, a recording's notes or an outline of an episode.
- The user wants chapter timestamps for a podcast or video platform.
- For cleaning the raw transcript first, use `use_skill` with `transcript-cleanup`. For the platform-specific video description, use `use_skill` with `youtube-description`.

## Steps

1. Read the transcript with `read_file`. If timestamps are present, note their format (seconds, mm:ss or hh:mm:ss). If there are none, say that chapters cannot be timed and offer to list topics in order instead. Ask with `ask_user` for the show's usual show notes format, if the user has one.
2. Find the speakers and their roles from the transcript or from what the user says. Do not guess a guest's title or employer. Mark unknowns with a visible placeholder.
3. Write the summary in two to four sentences covering what the episode is about and who it helps. Do not copy the intro blurb.
4. Mark topic changes in the transcript and make chapters: a short label of two to six words with the timestamp at the start of the first sentence of that topic. Use `run_code` to check that timestamps increase, use one format, and sit inside the total length.
5. Pull three to five takeaways as concrete statements, not topic names. Keep any quote word-for-word and attribute it to the right speaker.
6. Collect links and resources mentioned. Search the transcript with `search_files` for names of books, tools and sites. List only what was said; if the exact address is unknown, use `search_web` to find the official page, and mark it as found by search for the user to confirm.
7. Add the standard footer the user wants, such as credits, how to subscribe or contact. Do not invent any.
8. Save with `create_file` as `show-notes.md`.
9. Re-read the notes against three random timestamps: open the transcript at each and confirm the label matches what is said there.

## Gotchas

- Timestamps in an auto-generated transcript can drift from the final edited audio. Ask whether ads or cuts were added after the transcript.
- A mentioned product is not an endorsement. Do not add affiliate links unless the user supplies them.
- Summaries that praise the episode ("an insightful conversation") sell nothing. State what is covered.
- Names of guests are often misspelled by transcription. Verify against a source the user gives.
- Quotes drawn from filler-heavy speech need to be exact. If you tidy them, say that you did.
- Platforms strip or limit formatting in notes. Keep headings plain and test how the notes display.
- Sensitive remarks by guests may need the guest's approval before they appear in a summary.
- A promise of "everything you need to know" in the summary invites disappointment. Describe the scope.

## Output

- The result of the timestamp spot check.
- Summary, chapter list with timestamps, takeaways, links and credits in `show-notes.md`.
- A list of items that need the user's confirmation: names, links, timestamps.
