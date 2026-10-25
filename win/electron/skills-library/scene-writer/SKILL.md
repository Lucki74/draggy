---
name: scene-writer
description: Writes a single scene in which a character wants something, meets resistance and ends changed, using concrete detail and subtext instead of stated feelings. Use when the user says "write this scene", "draft the confrontation scene" or "turn this beat into a scene".
---

# Scene writer

## Goal

Produce one scene that does a job in the story. A good scene has a point of view, a goal, a source of resistance, a turn and an ending that differs from the start. The reader should feel the change without being told.

## When to use

- The user has an outline beat and needs prose.
- A scene exists but reads as summary or talking heads.
- The user wants two versions of the same moment to compare.

For dialogue-only revision, use `dialogue-polish`. For the whole plan, use `plot-outline`. For a full short story, use `use_skill` with `story-writer`.

## Steps

1. **Collect the setup.** Call `read_file` for the draft or notes, and `ask_user` for anything missing: whose point of view, tense, where and when, who is present, what happened just before and what must be true after.
2. **State the scene's job.** One sentence on what changes: information, power, trust, plan, mood. If nothing changes, suggest cutting or merging the scene.
3. **Give the viewpoint character a goal.** A small, immediate want within the scene, such as "get the key without being asked why". Give an opponent or an obstacle a goal too.
4. **Choose the entry point.** Start as late as possible, in the middle of action or talk. Skip arrivals, greetings and waking up.
5. **Plan three beats.** An opening move, a complication that raises cost, a turn where the plan or the balance breaks. Do not add a fourth unless the scene needs it.
6. **Draft with concrete detail.** Pick two or three sense details that carry mood: a sound, a texture, a smell. Use named things, not "a nice room".
7. **Let subtext work.** Characters talk about the key, the dishes or the weather while the real conflict sits underneath. Feelings are shown through action and what is left unsaid.
8. **Control the pace.** Short sentences and short paragraphs for tension, longer ones for reflection. Cut interior summary that repeats what action shows.
9. **End on the turn.** Stop shortly after the change. Do not explain it or add a closing thought.
10. **Check continuity.** Names, objects, time of day and injuries match the notes. Mark any assumption in a note under the scene.
11. **Offer a variant.** If the turn can break two ways, write a short alternate ending of three or four sentences so the user can compare.
12. **List the loose threads.** After the scene, note objects, promises or lines planted that later scenes must use or pay off.

## Gotchas

- Opening with a character waking up, arriving or looking in a mirror wastes the best lines. Start where the pressure is.
- Characters who state their feelings ("I am so angry") leave the reader nothing to do. Replace with a gesture or a choice.
- A scene without an obstacle is a description. Add someone who wants the opposite.
- Head-hopping within a scene breaks the viewpoint. Keep one head unless the user asks otherwise.
- Adverbs on dialogue tags mask weak lines. Fix the line.
- Repeating the same ending shape (a quiet sigh, a closed door) across scenes makes the book feel mechanical. Vary the exit.
- Putting backstory into the middle of a tense moment stalls it. Drop it in earlier or later.
- Describing every object in the room spreads the reader's attention thin. Choose the one thing a nervous person would notice.

## Output

The scene as prose, with no title and no commentary above it. Length as asked, or 500 to 900 words by default.

After the scene, a short note listing assumptions made and one alternative direction for the turn. Save with `create_file` only on request.

Match the user's existing style: tense, person and sentence length from the sample. Do not drift to a default voice.
