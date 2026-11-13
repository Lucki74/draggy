---
name: naming-generator
description: Generates names for characters, places, creatures and creative projects that fit a culture and tone, then checks them for look-alikes, unwanted meanings and clashes with well-known names. Use when the user says "I need a name for", "name my fantasy city" or "character names for a setting".
---

# Naming generator

## Goal

Hand the writer names that sound right for the world, are easy to tell apart on the page and carry no surprise meaning. A good name suits the culture, the role and the tone, and survives being read aloud.

## When to use

- Naming characters, towns, ships, species, gods, factions or titles.
- A cast has too many names starting with the same letter.
- The user wants a name for a creative project, such as a series or a band.

For business or product naming, use the branding skills. For the setting behind the names, use `worldbuilding`. For the characters themselves, use `character-profile`.

## Steps

1. **Collect the brief.** Call `ask_user` for: what is being named, the world or culture, the era, the tone (grim, playful, formal), how many names, any sounds to favor or avoid, and the language real-world inspirations if any.
2. **Read what exists.** If a name list or draft exists, call `read_file`. Note initial letters, lengths and syllable patterns already used.
3. **Set a naming pattern per culture.** Decide a few features: common sounds, syllable count, endings, how family names, titles or places work. Write the pattern in two lines so the set feels like one language.
4. **Generate twice as many as needed.** Mix lengths and starting letters. For places, include a descriptive element if the culture would name things by what they are.
5. **Use real roots with care.** If drawing on a real language, check meanings with `search_web` or a reliable dictionary page via `read_url`. Do not mash random words and claim they mean something.
6. **Check against clashes.** Search for each shortlisted name to see if it is a famous character, a brand or a real notable person. Avoid direct collisions.
7. **Check meanings.** Look for slang or rude senses in major languages the readers might speak. Note any, and drop or mark them.
8. **Check the page.** Compare initial letters and shapes: remove pairs such as Mara and Mira in one scene. Check for names that read awkwardly when said fast.
9. **Shortlist with reasons.** Give each name a one-line note: why it fits, how it is said, what it suggests. Mark the strongest few.
10. **Offer variants.** Provide a short form, a formal form or a nickname for main characters.
11. **Test them in a sentence.** Put the top names into a line of dialogue and a line of narration to see how they sit.
12. **Record the set.** Offer a short naming guide with the patterns used, so later names stay consistent.

## Gotchas

- Apostrophes and unusual letters to look exotic make names hard to read and to say. Use them only when a rule in the world explains them.
- Names that look alike in a crowded cast confuse readers. Vary the first letter and length.
- A real word with another meaning in a major language can ruin a serious scene. Check before settling.
- Names taken from a real culture should respect how that culture forms them. Check the pattern and do not mix unrelated traditions without intent.
- Naming a character after a real private person invites trouble. Use invented combinations.
- A project name that is already a trademark is a risk for published work. Tell the user to run their own search for any commercial use.
- Names that are hard to type or say slow readers and block word of mouth. Test by reading aloud.
- Generated names from a random mix often clash with real words. Read each as a stranger would.

## Output

A table or list with Name, Pronunciation, Meaning or feel, and Notes, grouped by what is named. Mark the top three picks. Add a line listing any clashes found and the checks run. No more than 20 names unless asked.

If the user wants more, ask which names they liked and generate close variants instead of new random ones.
