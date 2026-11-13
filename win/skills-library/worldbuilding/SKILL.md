---
name: worldbuilding
description: Designs a fictional world as far as the story needs, with rules, places, factions, history and the pressures they put on characters. Use when the user says "help me build a world", "design a fantasy setting" or "create the history of my world".
---

# Worldbuilding

## Goal

Make a setting that pushes on the plot. A good world has a few firm rules, places that suggest stories, groups that want opposite things and costs that fall on the people in it. It stops where the story stops needing it.

## When to use

- The user starts a novel, a game campaign or a comic in an invented place.
- The setting feels generic, or its parts do not connect.
- The user needs a short world bible for co-writers or players.

For magic or powers, use `magic-system-design`. For a playable adventure, use `tabletop-adventure`. For naming places, use `naming-generator`.

## Steps

1. **Read existing notes.** If a file exists, call `read_file`. List what is fixed. Everything new has to fit it.
2. **Ask what the story needs.** Call `ask_user` for: genre, tone, the main character's situation, the central conflict and the real-world influences. Ask how much detail the user wants, from a page to a full bible.
3. **Pick the pressure.** Choose one thing that squeezes ordinary lives: scarcity, a border, a debt, a law, a disease, a god who answers. Everything else in the world should relate to it.
4. **Set the base rules.** Geography, climate, technology level and who holds power. Keep it to a short list. For each rule, write one consequence for daily life: what people eat, trade, fear.
5. **Create three or four factions.** For each: what they want, what they will not do, what they hold, who they hate. Make at least two want incompatible things.
6. **Sketch four or five places.** For each, give a sensory detail, who controls it and a reason the story might go there.
7. **Write a short history.** Three to five events that still matter today, each with a living consequence. Skip ages the plot never touches.
8. **Add customs and texture.** A greeting, a taboo, a food, a swear word, a holiday. Pick ones that carry a value or a conflict.
9. **Check coherence.** Trace one ordinary job through the world: who pays, who protects, who profits. If it breaks the rules, fix the rules.
10. **List open questions.** Mark what is undecided so the user can decide later, instead of inventing it silently.
11. **Pick the first scene.** Choose the place and the group the first chapter touches and detail only those. Leave the rest as a short line each.
12. **Name the secrets.** List two things the world hides from its own people. They give the writer reveals without extra invention.

## Gotchas

- A detailed map and no pressure on characters is hobby cartography, not story. Always link a rule to a person.
- Rules that bend when the plot needs them destroy trust. If an exception is needed, make it a known cost.
- Lore dumps in the opening pages push readers out. Plan to reveal the world through conflict and objects.
- Cultures built as a single trait (the warrior people, the clever people) read as caricature. Give each group internal disagreement.
- Borrowing a real culture wholesale and renaming it invites errors. Check facts with `search_web` and avoid inventing "facts" about real peoples.
- Hierarchies of gods, races and calendars multiply fast. Add one only when a scene needs it.
- Sorting out trade routes and taxes for a story set in one house is a way to avoid writing. Stop when the story has what it needs.
- A world that matches the user's favorite game or book point for point will read as derivative. Change at least one base rule.

## Output

A world sheet with these headings: Pressure, Rules and their consequences, Factions, Places, History that still matters, Customs, Open questions. Keep to the length the user asked for, and 500 to 900 words by default.

Offer to save it with `create_file` and to build one scene using it.

For a game or co-writers, add a half-page player-facing summary with only what characters would know.
