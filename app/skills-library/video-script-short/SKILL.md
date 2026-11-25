---
name: video-script-short
description: Writes a script for a short vertical video with a fast opening line, one point, timed beats that fit the spoken length, on-screen text and a closing action, matched to the speaker's pace. Use when the user asks for a short video script, a reel, a TikTok or YouTube Short, or a talking-head clip.
---

# Short video script

## Goal

A script that fits the time, opens fast, makes one point and can be spoken naturally. Each beat has the words, the visual and the on-screen text. Length is checked against a real speaking pace.

## When to use

- The user wants a reel, short or vertical clip about a product, tip, story or announcement.
- The user has a long video or article and wants a short cut from it.
- For long-form footage to cut into clips, use `use_skill` with `content-repurpose`.
- For the post text that goes with the video, use `use_skill` with `social-post`.
- For catchy titles, use `use_skill` with `headline-writer`.

## Steps

1. Ask with `ask_user` for the platform, the length target (for example 20, 30 or 45 seconds), the topic, the audience, the speaker and style (talking head, voiceover, screen recording), the facts that may be stated and the action wanted at the end.
2. Check the platform's current length and caption rules with `search_web` if the user is unsure. Limits and features change often.
3. State the single point in one sentence. If the video needs two, make two videos.
4. Write the opening line, the first sentence the viewer hears or reads. It should name the problem, the result or the surprise within the first second or two. No intro, no greeting, no channel name first.
5. Plan beats: hook, setup in one line, the point with one example or demonstration, the payoff, the closing action. Give each beat a timestamp range.
6. Write the spoken words in short, plain sentences. Read them aloud in your head, and cut words that trip the tongue.
7. Check length. Count words with `run_command` and compare with the speaker's own pace. If the user does not know it, assume about 2.5 words per second as a rough guide and ask them to time a read-through. Trim until the total fits with a margin.
8. Add visuals and on-screen text for each beat: what is shown, what text appears, where captions sit so interface elements do not cover them. Most viewers watch without sound, so the text must carry the point.
9. Write the closing action: one request, such as follow, comment a word, or open a link. Make it specific and relevant.
10. Add a shot list and prop list, plus a suggested caption and a cover frame idea.

## Gotchas

- A slow opening loses viewers before the point arrives. Cut the first sentence if it is a warm-up.
- Too many points cannot be absorbed in 30 seconds. One point, one example.
- A script longer than the clip forces a rushed delivery. Time it aloud.
- Claims, prices and results must be true and allowed. Do not invent testimonials.
- Music and clips from other creators have licence limits. Flag them.
- Captions need to be accurate. Check names and numbers.
- Auto-captions mishear names and terms. Proofread them before publishing.

## Output

A table with Time, Spoken words, Visual, On-screen text for each beat, followed by the word count and estimated duration, a caption, a cover idea and the closing action.
