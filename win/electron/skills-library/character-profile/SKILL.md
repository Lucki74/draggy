---
name: character-profile
description: Builds a character profile with a want, a need, a flaw, a voice and a contradiction, so a writer can predict what the character does under pressure. Use when the user says "create a character for my story", "flesh out my protagonist" or "character sheet".
---

# Character profile

## Goal

Give the writer a person, not a list of traits. A good profile lets the writer answer "what would this character do next?" in any scene, and shows where that person will clash with the plot.

## When to use

- The user has a premise and needs a lead, a sidekick or a rival.
- A character feels flat or interchangeable with others in the draft.
- The user needs a quick profile for a game, a script or a roleplay.

For an antagonist, use `villain-design`. For a whole setting, use `worldbuilding`. For the story itself, use `use_skill` with `story-writer`.

## Steps

1. **Read what exists.** If the user has a draft or notes, call `read_file` and pull out everything already fixed: name, age, job, events, how others describe the character. Do not contradict it.
2. **Ask the minimum.** Call `ask_user` for: genre, the role in the story, one scene the character must survive, and the tone. Skip questions the notes answer.
3. **Set the want.** One concrete, visible goal the character chases in the story, such as "win the lease on the shop". Not a feeling.
4. **Set the need.** The thing the character lacks and does not see: trust, forgiveness, a lie to drop. The want and the need should pull against each other.
5. **Set the flaw and the wound.** The habit that sabotages the want, and one past event that explains it in a sentence. Stop at one event. A long backstory is not required.
6. **Add a contradiction.** One trait that does not fit the rest, such as a bully who feeds stray cats. It makes the character feel chosen, not generated.
7. **Define the voice.** Write four sample lines of dialogue: calm, angry, lying, joking. Note vocabulary, sentence length, what the character never says.
8. **Define the body and habits.** Two or three physical or daily details the reader can see: how they stand, what they carry, what they do when nervous. Pick details that show character.
9. **Test under pressure.** Write three short "if X then this person does Y" lines for choices the plot will force. If two answers are the same, the character is not yet distinct.
10. **Check for overlap.** If other characters exist, compare voices and wants. Change a name, a verbal habit or a goal where two are too close.
11. **Write the first line of a scene.** Give the character one opening sentence in a scene they would hate. It confirms the voice and shows what they would avoid.
12. **List what is still unknown.** Mark two or three questions the profile leaves open, so the writer can discover them in the draft instead of inventing them early.

## Gotchas

- Trait lists (brave, kind, clever) never force a choice. Tie each trait to a decision the character makes on the page.
- Eye color and favorite foods are filler unless they matter in a scene. Spend the space on conflict.
- A tragic backstory does not make a person. Specific habits and wrong beliefs do.
- Making the flaw cute defeats it. The flaw must cost the character something real.
- Avoid copying a known character with a new name. If the user's idea sounds like one, ask what makes theirs different.
- Do not assign identities, illness or trauma for color. If a trait touches a real group, ask the user for their intent and handle it with care.
- Keeping the profile secret from the page wastes it. Plan where each detail will show up in a scene.
- Changing a core trait mid-book without a cause reads as an error. Let change come from events.

## Output

The profile as plain headed notes: Name, Want, Need, Flaw, Wound, Contradiction, Voice (four lines), Habits, Choices under pressure. About 250 to 400 words. Save with `create_file` only if the user asks for a file.

End with one question the writer must answer to keep the character alive in the draft. No advice on writing craft.

If the user has several characters, produce them in one pass and add a short table of wants side by side, so conflicts are visible.
