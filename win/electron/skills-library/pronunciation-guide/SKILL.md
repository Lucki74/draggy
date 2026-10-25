---
name: pronunciation-guide
description: Explains how to say a word, a sound or a phrase in a target language using the learner's own language as a reference, with the phonetic symbol, stress, common errors and minimal pairs to practise. Use when the user asks how to pronounce something, wants to improve an accent, or cannot hear the difference between two sounds.
---

# Pronunciation guide

## Goal

Tell the learner what to do with their mouth and voice to produce the sound, which errors to avoid, and how to practise. Text cannot play audio, so the guide says what it can and cannot teach, and points to recordings for the rest.

## When to use

- The user asks how to say a specific word or name.
- The user struggles with a sound, a stress pattern or the rhythm of a language.
- The user wants words to learn: use `use_skill` with `vocabulary-builder`.
- The user wants to practise conversation: use `conversation-practice`.

## Steps

1. **Collect the details.** Use `ask_user` for the word or sound, the language and variety (accent matters), the learner's first language and what they currently say.
2. **Give the sound in IPA.** Write the standard phonetic transcription and name the sound class (rolled r, nasal vowel). Check it in a dictionary page found with `search_web` and opened with `read_url`.
3. **Compare with the learner's language.** Say whether a close sound exists, and how it differs. If no equivalent exists, say so instead of forcing a false match.
4. **Describe the mouth.** Give a short instruction: tongue position, lips, voice on or off, air. One simple action at a time.
5. **Mark the stress and rhythm.** Show which syllable is stressed and how the sentence rhythm falls, in a plain pattern such as "da-DUM-da".
6. **Give a respelling carefully.** Offer an approximate respelling using the learner's own spelling, labelled as approximate, and note which accent it suits.
7. **Predict the errors.** From the learner's first language, name the two most likely errors and what they sound like to a native listener.
8. **Provide minimal pairs.** List word pairs that differ only in the target sound, and give a short drill of say-the-pair then say-the-word-in-a-sentence.
9. **Point to audio.** Recommend a source for native recordings, such as a dictionary with audio or a pronunciation database, after checking it exists with `read_url`. Suggest recording themselves and comparing.
10. **Practise in context.** Give three short sentences using the sound, to read aloud slowly and then at speed.
11. **Set a small routine.** Five minutes a day on one sound for a week beats a long single session.

## Gotchas

- Respellings made for English readers mislead speakers of other languages. Use the learner's own reference sounds.
- Accents differ within a language. Name the variety and note where another differs.
- A sound can change in connected speech. Show the word alone and in a phrase.
- Without audio, claims that a learner "now sounds right" are impossible. Be clear that you are describing, not hearing.
- Over-correcting small differences produces strain. Rank the errors by how much they hurt understanding.
- Names of people and places have local pronunciations. Check, do not assume the textbook rule.
- IPA symbols vary by dictionary convention. State which one you use.

## Output

The IPA, the mouth instruction, the stress pattern, the likely errors, then minimal pairs and sentences. Keep it to one sound or word group per answer.
End with the single next practice step.
