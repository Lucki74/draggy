---
name: formal-vs-informal
description: Decides and explains the right level of politeness in a target language for a given person and setting, showing the same message in formal and informal versions with the pronoun, verb and vocabulary changes. Use when the user is unsure whether to use the polite or casual form, or wants a message rewritten for another register.
---

# Formal vs informal

## Goal

Pick the register that fits the relationship and the culture, and show what changes between versions. The learner leaves with a safe default, a clear rule for when to switch, and a message in the right tone.

## When to use

- The user asks which form to use with a boss, a teacher, a stranger, a friend or an older person.
- The user has a message and wants a formal or a casual version.
- The user is checking a full text for mistakes: use `use_skill` with `writing-correction`.
- The user is preparing for a specific situation: use `scenario-phrasebook`.

## Steps

1. **Collect the context.** Use `ask_user` for the language and country, who the reader is, the relationship, the medium (email, chat, speech) and who is older or senior.
2. **Name the system.** Say how the language marks politeness: a separate pronoun, verb endings, titles, honorific words, set phrases. Confirm the details with `search_web` and `read_url` if the language is not one you know well.
3. **Give the safe default.** Recommend the form that does least harm if the learner is wrong, usually the polite one with strangers and in writing, and say what changes by region.
4. **Explain switching.** Describe how people move to the informal form: who proposes it, the usual phrase, and when to wait to be invited.
5. **Show a pair.** Write the same sentence in both registers and mark the differences: pronoun, verb form, vocabulary, greeting, closing.
6. **Rewrite the user's message.** If they supplied one, produce the target register and list each change. Edit with `edit_file` if it is in a file, on a copy.
7. **Cover greetings and closings.** Provide matching openings and sign-offs for each register, since these carry most of the tone.
8. **Add titles and names.** Say how to address the person: first name, surname, title, and whether titles are used in this culture.
9. **Note the mixing risk.** Warn about inconsistent register within one message, such as a formal greeting then casual slang.
10. **Check the tone.** Read the result as the receiver would: warm, cold, pushy, servile. Adjust length and softening phrases.
11. **Give a practice item.** Offer three situations and ask which form fits, then explain.

## Gotchas

- Rules differ between countries sharing a language. A form common in one region can sound cold or odd in another.
- Workplaces may use the informal form among all staff. Observing the partner's own usage beats a textbook rule.
- Age, rank and setting each matter. Do not reduce it to one rule.
- Overly formal language can sound distant or sarcastic with friends. Offer a way to warm the tone while staying correct.
- Social norms shift over time. Treat advice from older sources as possibly dated and check it.
- Machine translation often picks one register without telling you. Verify the form in the output.
- Do not make cultural claims you cannot support. Say when practice varies and recommend asking the person.

## Output

The default recommendation, the switching rule, a formal and informal pair with changes marked, greetings and closings, and the rewritten message if given. Keep each part to a few lines.
Name the country or region the advice covers.
