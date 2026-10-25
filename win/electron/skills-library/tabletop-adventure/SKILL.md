---
name: tabletop-adventure
description: Prepares a playable tabletop RPG adventure or one-shot with a hook, locations, challenges, non-player characters and several routes to the goal, scaled to the session length. Use when the user says "write a D&D adventure", "plan a one-shot" or "prepare my next session".
---

# Tabletop adventure

## Goal

Give a game master material they can run at the table. A good adventure has a clear hook, a few memorable places and people, challenges of different kinds and no single required path, with notes kept short enough to find mid-session.

## When to use

- The user is a game master preparing a one-shot or the next session.
- The user needs a dungeon, a mystery, a heist or a travel scenario.
- The user has an idea and wants it shaped into a playable form.

For the world around it, use `worldbuilding`. For the opposing force, use `villain-design`. For names, use `naming-generator`. For rules, check the game's own rulebook.

## Steps

1. **Ask the table facts.** Call `ask_user` for: the game system and edition, number of players, character level or power, session length, tone, and the group's tastes (combat, talking, puzzles, exploration). Ask about topics to avoid.
2. **Read existing material.** If the campaign has notes, call `read_file`. Keep names and facts consistent.
3. **Write the hook.** One paragraph: what the players are asked to do, why their characters care, and what happens if they do nothing.
4. **Set the goal and stakes.** A clear objective, a clock or pressure (a deadline, a rival), and a cost for failure beyond death.
5. **Design five to seven scenes.** Mix types: a social scene, a discovery, a challenge, a combat or danger, a reveal, a climax. For a four-hour session, aim for the lower end.
6. **Make locations playable.** For each, give three sensory details, what is interesting, and what can be done there. Use short bullet lines.
7. **Create non-player characters.** For each key person: a name, a want, a secret, a quirk of speech and what they know. Four or five are enough.
8. **Build multiple routes.** For every obstacle give at least two ways past it: force, talk, stealth, cleverness, a clue found elsewhere. A key clue should appear in three places.
9. **Prepare numbers carefully.** For monsters and traps, refer to the rulebook the user has, and check the stats there. Do not invent official statistics from memory. If a rule matters, use `search_web` or ask the user to paste the entry.
10. **Add contingency.** A list of what to do if the players skip a scene, kill a key person, or finish early. Include two spare encounters and a short epilogue.
11. **Write the first five minutes.** Draft the opening description and the first question to the players, so the session starts with momentum.
12. **Make a one-page cheat sheet.** Collect names, key facts, clocks and roll targets in a single page, large enough to read in dim light.

## Gotchas

- A plot that needs the players to choose the one path fails at the first off-script decision. Plan situations, not a storyline.
- Pages of lore that never reach the table are wasted prep. Write what players can see, hear and do.
- Too many combat rounds eat a session. Estimate each fight's time and leave slack.
- Clues locked behind one roll can stall the game. Let a failure cost time, not progress.
- Using another publisher's text or maps without permission is a rights problem. Write original content and refer to published material by name only.
- Players have different comfort limits. Settle them before play, not in the middle of a scene.
- Fixed monologues from non-player characters stall play. Give them questions to ask the players.
- Rewards need a plan too: treasure, information or a change in the world. Decide them before play.

## Output

An adventure sheet: Hook, Goal and stakes, Scene list with timings, Locations, NPCs, Routes and clues, Encounters (with rulebook references to fill), Contingencies, Epilogue. Short bullets, 700 to 1,100 words. Offer to save with `create_file`.

Keep stat blocks out of the text unless the user pasted them. Reference page numbers or names to fill in.
