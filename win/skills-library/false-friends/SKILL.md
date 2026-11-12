---
name: false-friends
description: Finds and explains false friends between the learner's language and a target language, words that look or sound alike but mean something different, with the real meaning, a safe alternative, and examples on both sides. Use when the user asks about false friends, looks for words to avoid, or wants to prevent embarrassing mistakes.
---

# False friends

## Goal

Warn the learner about the traps that cost them most: look-alike words that mislead. Each entry says what the learner expects, what the word really means, how to say the intended idea and which side of the pair is riskier in conversation.

## When to use

- The user is learning a language related to their own and keeps guessing wrong from similar words.
- The user wants a list for a specific pair, such as English and Spanish.
- The user wants words picked for a goal: use `use_skill` with `vocabulary-builder`.
- The user wants an expression explained: use `idioms-explainer`.

## Steps

1. **Identify the pair.** Use `ask_user` for the learner's language, the target language and variety, and level. A list for a beginner differs from one for an advanced learner.
2. **Choose the scope.** Ask whether they want the most common ones, those for a topic (food, work, travel), or those that come up in a text they supply. Read a supplied file with `read_file`.
3. **Collect candidates.** Use `search_web` for lists of false friends for this pair and open two or three with `read_url`. Do not trust a single list, since they disagree.
4. **Verify each candidate.** Check meanings in a dictionary for both languages. Confirm that the words really differ, in which senses and in which regions.
5. **Sort by type.** Total false friends (completely different meanings), partial ones (overlap in some senses) and true cognates that only look odd. Keep only the first two groups.
6. **Rank by risk.** Put at the top the ones that are common and embarrassing or change meaning sharply. Move rare literary words to a short footer.
7. **Write the entry.** For each: the word, what a learner assumes, the real meaning, the word they should use instead, and two example sentences, one for each meaning.
8. **Note the region.** Mark entries that differ between countries or varieties, and say where.
9. **Add a pronunciation or spelling hint** if the pair is confusable only in writing or only in speech.
10. **Make a quiz.** Add eight sentences with a gap or a choice and an answer key for self-testing.
11. **Save.** Write the list with `create_file`, as a table that sorts by risk.

## Gotchas

- Lists on the web copy each other, mistakes included. Check each entry in dictionaries.
- Many "false friends" are partly true. Calling them wrong teaches the learner to avoid a word that is fine in most uses.
- Meanings drift. A sense that was true a generation ago may be rare now. Look at current usage.
- Regional differences are large. A harmless word in one country may be vulgar in another.
- Do not explain by invented etymology. If the origin is uncertain, leave it out.
- Direction matters: the trap for a Spanish speaker learning English is not the same list as the reverse.
- A list of 200 will not be learned. Give the top 20 with examples.

## Output

A table with word, expected meaning, real meaning, use instead and examples, ordered by risk, followed by a short quiz and the answers. Mention the date sources were checked.
Keep notes short and in the learner's language.
