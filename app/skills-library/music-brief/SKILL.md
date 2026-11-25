---
name: music-brief
description: Writes a music brief for a video, game or presentation covering mood, tempo, structure against the picture, instruments, mix room for dialogue and licence needs, and finds options only through sources with clear terms. Use when the user asks what music to use, wants to brief a composer, or needs background music.
---

# Music brief

## Goal

Say what the music must do in words a composer, a library search or a generation tool can act on. The brief ties the music to moments in the picture and settles the licence before the user falls for a track.

## When to use

- The user is choosing or commissioning music for a project.
- A temporary track is in the edit and a real one is needed.
- For the edit itself, use `use_skill` with `video-edit-plan`. For voice work that the music has to sit under, use `use_skill` with `voiceover-script`.

## Steps

1. Ask with `ask_user` for the project, the audience, the length, where it will be published, whether there is dialogue or narration, and the budget. Ask for two or three reference tracks and what the user likes about each: tempo, instruments, build, feeling.
2. Write the purpose of the music in one line: lift the energy, calm a tutorial, mark a reveal, hold a mood. If the answer is "fill the silence", say so; that points to quiet ambient bed.
3. Describe the sound in plain terms: mood words with opposites ("warm, not sentimental"), tempo range, key instruments or textures, whether it has vocals (vocals compete with speech), and the energy curve over time.
4. Map the structure to the picture: where music enters, where it should drop under speech, hit points such as a title or a reveal, and where it ends (hard stop, fade, loop). Write times in a small table.
5. State mix needs: leave room in the middle frequencies for voice, and ask for stems or an alternate version without lead instruments if a composer is hired.
6. Settle licence before choosing. List the uses needed (online, ads, broadcast, paid promotion, perpetual, territories). Search the licence terms of any library with `search_web` and `read_url`, and read them rather than trusting a badge. Platform "free" libraries may allow use only inside that platform. Note any attribution wording needed.
7. If the user wants options, give search terms for libraries and describe the type of track. Do not claim a named track is cleared. If using a generation tool, read its terms on commercial use and state them.
8. Save with `create_file` as `music-brief.md`.
9. Plan the review: ask the user to play shortlisted tracks under the actual cut, with dialogue, at the real mix level, and to reject any that fight the voice.

## Gotchas

- A temp track from a commercial song creates attachment, and the replacement always feels worse. Brief from the reference's qualities.
- Music with a strong melody under narration pulls attention from the words. Prefer texture.
- Content ID systems can flag licensed music. Ask the library how to avoid false claims and keep proof of licence.
- Loops that end abruptly need a planned ending. Ask for an outro or a cut-down version.
- Do not assume a free download is free for ads or client work.
- Tempo and beat should suit the cut rhythm. A track at the wrong speed makes the edit feel off.
- Cultural associations of instruments and scales differ. Check them for the target audience.
- Keep the licence document with the project files. Without it, a later takedown is hard to contest.

## Output

- The review method for the shortlisted tracks.
- `music-brief.md` with purpose, sound description, timing table, mix needs and licence needs.
- Reference tracks with the quality borrowed from each.
- A licence checklist for any candidate.
