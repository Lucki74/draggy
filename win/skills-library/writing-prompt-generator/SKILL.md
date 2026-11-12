---
name: writing-prompt-generator
description: Generates writing prompts that combine a character, a situation under pressure and a constraint, tuned to the user's genre, length and skill level. Use when the user says "give me writing prompts", "I have writer's block" or "prompts for a short story".
---

# Writing prompt generator

## Goal

Hand the writer a starting point they want to write, not a list of generic ideas. A good prompt has someone who wants something, a reason it is hard and a limit that forces choices.

## When to use

- The user wants ideas for daily practice, a contest, a class or a group.
- The user is blocked on a project and needs a side exercise.
- A teacher or club needs a set of prompts on a theme.

For developing a chosen idea, use `plot-outline` or `character-profile`. For a tiny finished story, use `flash-fiction`. For opening text, use `opening-lines`.

## Steps

1. **Ask what is needed.** Call `ask_user` for: genre or "any", how many prompts, who writes (beginner, regular, class), the time available, and any topics to avoid. If the user is blocked on a project, ask for a sentence about it.
2. **Choose the prompt types.** Mix a few: situation prompts, character prompts, object prompts, opening-line prompts, constraint prompts, dialogue-only prompts.
3. **Build each prompt from three parts.** A specific person with a want, a situation that pressures it, and a constraint (a word limit, a point of view, a forbidden word, a single setting, a time limit).
4. **Make it specific.** Replace "a woman finds a box" with "a night-shift pharmacist finds a key taped under the counter and has until the delivery arrives to decide whether to try it".
5. **Vary the angle.** Spread the set across tone (funny, sad, strange), setting, point of view and form (letter, list, scene, monologue).
6. **Tune the difficulty.** For beginners, one clear want and a short limit. For experienced writers, a constraint that stretches craft, such as telling the story only through objects.
7. **Check for clichés.** Remove prompts that are the standard version (the chosen one, the amnesiac, the last person on earth) unless a twist is built in.
8. **Add a quick-start line.** For each prompt, give a possible first sentence or question to answer, to lower the barrier.
9. **Avoid real people and sensitive harm.** Do not base prompts on real private individuals, and avoid prompts built on a real tragedy. Keep dark themes only when the user asks.
10. **Offer to go deeper.** Ask which prompt the user will take and offer a starter outline or a timed sprint plan.
11. **Add one wildcard.** Include a single odd prompt that breaks the pattern, such as writing from the object's point of view.
12. **Offer a timed format.** Suggest a ten-minute sprint or a one-page limit for each prompt, to lower the pressure.

## Gotchas

- A premise with no pressure is not a prompt. "A dragon who likes tea" gives nothing to do. Add a want and an obstacle.
- Mix-and-match generators produce nonsense combinations that do not tell a story. Check each prompt for a real conflict.
- A prompt that needs research or niche knowledge stalls writers. Keep the setting accessible unless asked.
- Too many constraints in one prompt kill the voice. Use one or two.
- Prompts reused across a group lead to similar stories. Give variants so each person starts differently.
- Do not claim prompts are original in a literal sense. They are starting points.
- Dozens of prompts overwhelm. Give a few good ones and offer more.
- Prompts built on trauma or real tragedies can hurt a group writing together. Keep group prompts safe by default.

## Output

A numbered list of prompts, each two to three sentences, tagged with genre and constraint. Add the quick-start line in italics or after a dash. Default: five prompts. End with one line asking which to develop.

If it is for a class or club, add a one-line instruction for each prompt that a teacher can read out.
