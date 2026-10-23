---
name: vocabulary-builder
description: Chooses the most useful words for a learner's goal and level in a target language, gives each with a natural example, its forms and common partners, and sets up a short routine to review them. Use when the user asks for words to learn, wants to build vocabulary, or asks which words matter most for a topic.
---

# Vocabulary builder

## Goal

Hand the learner a short list of words they are likely to meet and use, each shown in context and ready to review. The list is small enough to learn this week and chosen for their purpose, not for alphabetical neatness.

## When to use

- The user is learning a language and wants words for a goal: travel, work, exams, a hobby, reading.
- The user has a text and wants its useful words picked out.
- The user wants the phrases for one situation: use `use_skill` with `scenario-phrasebook`.
- The user wants to be drilled on verb forms: use `verb-conjugation-drill`.

## Steps

1. **Get the profile.** Use `ask_user` for the target language and variety, the learner's level, their goal, and how many minutes a day they have.
2. **Set the batch size.** Start with 10 to 15 new words per week for a busy learner, up to 30 for an intensive one. Say the number.
3. **Choose by use.** Favour common words in the learner's topic. For a general goal, use frequency lists found with `search_web`. For a text, read it with `read_file` and pick words that recur or block understanding.
4. **Check each word.** Confirm meaning, part of speech and the forms learners need: gender and plural for nouns, principal parts for irregular verbs. Verify against a reliable dictionary page with `read_url` when unsure.
5. **Write a natural example.** One short sentence per word in everyday language, at the learner's level. Avoid examples that only make sense in a poem or a textbook.
6. **Add common partners.** Show one or two words it usually appears with, such as a verb that takes this noun. Learners recall chunks better than single words.
7. **Group by theme.** Put words into small related sets so they support each other, but separate look-alike words into different sessions to prevent mixing.
8. **Mark traps.** Flag false friends with the learner's language, irregular forms and words with two meanings.
9. **Build the list.** Save a table with `create_file`: word, meaning, example, partners, notes. Add a column for a self-rating after review.
10. **Set the review.** Suggest a quick self-test the next day, after three days and after a week, covering from meaning to word as well as word to meaning.
11. **Adjust.** After a week, ask which words were never needed and cut similar ones from the next batch.

## Gotchas

- Frequency lists mix written and spoken use. A word frequent in news may be rare in conversation, so match the list to the goal.
- Single-word translation lists give false certainty. Many words only match in some contexts, so keep the example.
- Too many new words per day pushes older ones out. Cap the batch and keep reviewing.
- Regional vocabulary differs: a word safe in one country can be rude or odd in another. Name the variety.
- Learners often need passive recognition first and active use later. Say which skill each word is for.
- Do not invent example sentences with rare constructions. If unsure a sentence is natural, check it or simplify.
- Mnemonics help only when personal. Offer a hook, but let the learner replace it with theirs.

## Output

A table of words with meaning, example, partners and notes, then a three-line review plan. Mention the file path if one was saved.
Keep notes in the learner's language and examples in the target language.
