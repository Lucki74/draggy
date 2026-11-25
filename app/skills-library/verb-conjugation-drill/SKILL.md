---
name: verb-conjugation-drill
description: Runs an interactive drill on verb forms in a target language, starting with the learner's weak tenses and persons, mixing regular and irregular verbs, with immediate feedback and a score by pattern. Use when the user wants to practise conjugation, memorise tenses, or fix verb endings.
---

# Verb conjugation drill

## Goal

Build quick, accurate recall of verb forms. The drill picks verbs and tenses the learner needs, asks in short rounds, explains every miss with the pattern behind it and ends with a list of forms to review.

## When to use

- The user wants practice on tenses, moods or irregular verbs in a language.
- The user keeps making the same ending errors in speech or writing.
- The user needs the rule behind a form: use `use_skill` with `grammar-explainer`.
- The user wants words to learn, not forms: use `vocabulary-builder`.

## Steps

1. **Set the scope.** Use `ask_user` for the language, level, tenses and moods to practise, verb types (regular, irregular, reflexive) and the number of items for the session.
2. **Run a quick placement.** Ask five mixed items first. Use the results to choose where to focus.
3. **Choose the verbs.** Pick common verbs the learner will use, mixing regular patterns with the irregular ones that appear most. Avoid rare verbs.
4. **Ask in context.** Give a short sentence with a gap and the infinitive in brackets, rather than a bare "conjugate this". Forms learned in sentences transfer to speech.
5. **Ask one item at a time.** Wait for the answer with `ask_user`. Do not show the next item until you mark the current one.
6. **Mark and explain.** If correct, confirm and move on. If wrong, show the right form and the rule or pattern in one line, such as the stem change, and note which part was wrong.
7. **Vary the person and tense.** Rotate persons and tenses so the learner cannot rely on a repeating pattern. Add negative and question forms later.
8. **Group by pattern.** Cluster irregular verbs that share a change so the learner learns the family, not 40 isolated cases.
9. **Repeat the misses.** Bring back missed forms after a few items, then again at the end of the session.
10. **Score.** Report the result by tense and by verb type, such as 9 of 10 present regular and 4 of 10 past irregular.
11. **Close the round.** List the five forms to review, suggest a time to repeat the drill, and offer a harder set.

## Gotchas

- Tables memorised out of context do not help speaking. Keep drills in sentences.
- A drill of 50 items tires the learner and lowers accuracy. Use rounds of 10 to 15.
- Irregular forms differ by variety and register. Name which one you use, such as a spoken form.
- Check the answer key carefully. A wrong key teaches the wrong form, so verify doubtful forms with `search_web` and a reputable conjugation reference.
- Accept variants that are correct. Do not mark a valid alternative form as wrong.
- Mixed tenses early confuse beginners. Start with one tense and add the second after a good score.
- Do not hide the pattern. Learners improve when they see why a form is what it is.

## Output

Per item: the sentence, the learner's answer, the verdict and the rule. At the end: the score table and the review list.
Keep feedback to one or two lines per miss.
