---
name: joke-and-humor-writer
description: Writes jokes and light humor for a stated audience and occasion, with setup, turn and tag, and flags lines that could land badly. Use when the user says "write a joke about", "make this funnier" or "add humor to my talk".
---

# Joke and humor writer

## Goal

Make people laugh in the room the user is actually in. A good joke fits the audience, has a clear setup, a surprising but fair turn and a short tag, and does not rely on hurting someone present.

## When to use

- The user wants a joke, a pun, a funny opener or a few lines of light humor for a talk, card or post.
- A draft is meant to be funny and falls flat.
- The user wants gentle teasing for a roast or a team event within agreed limits.

For a toast, use `toast-writer`. For a full speech, use `use_skill` with `speech-writer`. For funny verse, use `poetry-draft`.

## Steps

1. **Learn the room.** Call `ask_user` for: the audience (age, relationship, mix of strangers and friends), the occasion, the setting (spoken or written), the length, how edgy the room tolerates, and any topics that are off limits.
2. **Find the material.** Ask for two or three true, specific facts about the subject: a habit, a mishap, a quirk. Humor from real detail beats a generic joke.
3. **Choose a device.** Options: exaggeration, understatement, a list with a break in the third item, a reversal, a callback, a comparison that is wrong in a useful way, wordplay.
4. **Write the setup.** Short, clear, with no wasted words. The audience must know enough to see the turn, and no more.
5. **Write the turn.** Put the surprise at the end of the sentence, on the last word if you can. Remove words after the laugh point.
6. **Add a tag.** A second small joke on the same idea, which often gets the bigger laugh.
7. **Write several options.** Give five to eight lines of different types so the user can choose what suits their voice.
8. **Check for risk.** Flag jokes that target a person present, a protected group, a recent loss, a sensitive health or money matter, or a workplace power gap. Rewrite to aim at the speaker, a situation or an object.
9. **Check originality.** Avoid jokes that are familiar one-liners. If a line sounds known, change it or check by `search_web` for an exact match.
10. **Give delivery notes.** Mark where to pause, where to slow down, and which line to cut if the room is cold.
11. **Order the set.** If using several jokes, put a safe, quick one first, the best one in the middle or near the end, and a callback last.
12. **Offer a clean-version swap.** For any edgy line the user keeps, provide a milder alternative they can switch to on the day.

## Gotchas

- Explaining the punchline kills it. If it needs an explanation, rewrite it.
- Humor aimed at someone present who did not agree to it turns the room cold. Make the speaker the target before anyone else.
- Written jokes read differently spoken. A pun that works on a page can die aloud. Ask which.
- Inside jokes only land for those inside. Check how many in the audience will get it.
- Too many jokes in a row lose force. Space them with plain text.
- Borrowing a comedian's routine or a viral post and presenting it as your own is common and risky. Write from the user's facts.
- Laughing at your own joke before the audience does steals the beat. Note this in the delivery tips.
- Humor styles differ across cultures. Ask where the audience is from if unsure.

## Output

A numbered list of jokes grouped by device, each marked Safe or Check (with the reason), and a recommended top three with delivery notes. Under 400 words. No lecture on comedy.

If the humor is for written copy such as a card or a post, tighten each joke to one or two sentences.
