---
name: persona-prompt
description: Writes a persona or voice prompt for an assistant or character, defining voice, knowledge limits, boundaries and sample lines, keeping accuracy and safety above style, and testing for drift across a long conversation. Use when the user asks for a character prompt, wants an assistant to speak in a certain voice, or needs a persona for a bot.
---

# Persona prompt

## Goal

Give an assistant a consistent voice without letting the voice override honesty. The prompt describes how the persona sounds, what it knows and refuses, and how it behaves under pressure, and it has been tested for several turns of conversation.

## When to use

- A product, game or story needs a character that talks in a set style.
- A brand wants its assistant to sound a particular way.
- For the full standing instructions of an assistant, use `use_skill` with `system-prompt-designer`.
- For a brand voice guide used in writing, use `use_skill` with `brand-voice-guide`.

## Steps

1. Ask with `ask_user` who the persona is for, where it appears, its role, how formal it is, what it must never do, and whether it is fictional or a brand voice. Ask for sample text in the voice, if any exists.
2. Decide the line between style and substance. Style covers word choice, rhythm, humour and address. Substance covers facts, safety and policy. The persona changes the first and never the second.
3. Describe the voice through behaviour, not adjectives alone. "Short sentences, dry humour, never uses exclamation marks, calls the user by first name" works better than "witty and friendly".
4. Set knowledge limits. Say what the persona knows and what it does not, and what it does when asked about the unknown: stay in character while admitting it does not know. A fictional character should not give false facts as true to a real user.
5. Set boundaries. The persona must not claim to be human when sincerely asked, claim real experiences, impersonate a real person, or use the voice to pressure users. State how it steps out of character when safety or clarity needs it.
6. Write five to eight sample lines across moods: greeting, helping, saying no, an error, an off-topic question. Keep them varied so the model catches the voice and not a single phrase.
7. Add behaviour under pressure: what to do when the user asks it to drop the persona, to say something off-brand, or to ignore its rules.
8. Test over a long conversation. Run at least ten turns, with a topic change, a hard request and an attempt to break character. Note when the voice fades or becomes a caricature.
9. Revise. Reinforce the traits that drifted, cut those that caricature, and save the prompt with `create_file`, plus the test transcript.

## Gotchas

- Stacking many adjectives yields a parody. Choose three or four traits.
- Voice drifts as the conversation lengthens. Test long conversations as well as short ones.
- A persona that must always stay in character fails users who need a plain answer. Allow a plain mode.
- Do not base a persona on a real living person without permission.
- Humour and dialect can be offensive or hard to read. Check with the audience.
- Never let the persona hide a limit as a joke when the user needs a clear answer.

## Output

- The persona prompt and the sample lines.
- The boundaries and the step-out rule.
- The long-conversation test results.
- Known drift points to watch.
