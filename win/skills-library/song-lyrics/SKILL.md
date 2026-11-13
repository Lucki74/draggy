---
name: song-lyrics
description: Writes song lyrics with a clear hook, verses, chorus and bridge, singable lines and one emotional idea, and checks stress against a stated rhythm. Use when the user says "write song lyrics", "help me with a chorus" or "lyrics for a song about".
---

# Song lyrics

## Goal

Write words that work when sung. A good lyric has one idea, a hook the listener can repeat after one hearing, verses that add new detail and a chorus that gives the emotional point without repeating the verse.

## When to use

- The user has a theme, a title or a melody and needs words.
- A chorus is weak or a verse does not move forward.
- The user wants to fit lyrics to a given structure or syllable count.

For a poem to be read, use `poetry-draft`. For comic songs, add `joke-and-humor-writer`. For a toast, use `toast-writer`.

## Steps

1. **Gather the brief.** Call `ask_user` for: genre, theme, point of view, mood, any title or hook line, tempo or a reference of feel (not a song to copy), and whether a melody or rhythm already exists.
2. **Define the one idea.** Write it as a sentence: "This song is about leaving the town you love." If the idea needs "and" more than once, it is two songs.
3. **Write the hook.** Make a short phrase of three to six syllables that carries the idea and sounds good spoken. Try five options and pick the one that does not need explanation.
4. **Plan the structure.** Verse, chorus, verse, chorus, bridge, chorus is the common form. Ask if the user wants another. Say what each section does: verses show, the chorus states, the bridge turns.
5. **Draft the chorus first.** Keep lines parallel and short. Repeat the hook in the first or last line. Use plain words.
6. **Draft verses with detail.** Each verse adds new images, people or events. Verse two must move the story or the feeling, not restate verse one.
7. **Check the sound.** If a melody exists, ask for the syllable count per line and match it. Check stress: strong beats should fall on stressed syllables. Mark spots where the sung stress would be wrong.
8. **Rhyme with care.** Use a consistent scheme per section. Allow near rhymes. Avoid ending every line with a forced pair like love and above.
9. **Write the bridge.** A change of angle, key image or perspective, short, before the last chorus.
10. **Review as a listener.** Cut lines that need a reader's eye to understand. Replace tongue-twisters. Produce a clean version with section labels.
11. **Write a second chorus variant.** Change one or two lines in the last chorus to reflect what the song learned, so the repeat feels earned.
12. **Check the title and the hook line.** The title should appear in the chorus and be easy to remember after one hearing.

## Gotchas

- Lines that scan on paper can fall apart sung, especially with long words on short notes. Ask for the melody or a rhythm to test.
- A chorus that rephrases the verse adds nothing. It must say the point.
- Echoing a famous song's lines or structure in distinctive wording is a copyright risk. Write fresh words and avoid quoting known lyrics.
- Heavy cliché rhymes (heart and apart, fire and desire) make a lyric forgettable. Use specific images.
- Do not stuff every beat with words. Space lets the melody breathe.
- Profanity or sensitive topics change what suits the audience. Ask for the intended listeners.
- A bridge that restates the chorus wastes the place to turn. Change the angle.
- Prosody problems often hide in the first word of a line. Check where the strong beat falls.

## Output

The lyric with section labels (Verse 1, Chorus and so on), no commentary above it. Then up to four lines: the hook, the one idea and any place where stress or syllable count may need a melody check.

If the user supplies a melody or a count, add a line-by-line syllable table after the lyric.
