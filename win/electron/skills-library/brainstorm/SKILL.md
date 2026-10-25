---
name: brainstorm
description: Generates many varied ideas for names, projects, gifts, content, solutions or strategies, then helps narrow them down against clear criteria. Use when the user asks for ideas, options, suggestions, names or a brainstorm.
---

# Brainstorm

## Goal

Give the user a wide spread of ideas that are not variations of one thought, then, if they want it, a short list chosen against criteria that fit their goal. Good brainstorming has two separate phases: go wide, then choose.

## When to use

- The user asks for ideas, options, suggestions, names or "a brainstorm".
- The user reacts to a first round ("more like number 4") and wants another.
- For a decision between named, existing options, use `use_skill` with `compare-options`.

## Steps

1. Restate the goal and constraints in one line: audience, budget, tone, must-haves, what has been tried.
2. Generate ideas from several angles:
   - the obvious, done very well
   - the opposite of the obvious
   - borrowed from another field or industry
   - the cheapest or fastest version
   - no constraints at all
   - what the target person would ask for themselves
3. Default to 12 to 20 ideas grouped by angle, each in one line with a few words on why it could work.
4. For names, vary the style (descriptive, invented, metaphor, compound, short and punchy). Check they are easy to say and spell, and flag any likely to be taken or to carry an unfortunate meaning in common languages. With web access, spot-check the top names with `search_web`.
5. To narrow down, propose three or four criteria that fit the goal (impact, cost, effort, originality, fit with the brand). Pick the top three ideas against them, with one line each on the strongest argument and the biggest risk. Suggest a quick next step to test the best one.
6. If the user just wants the list, stop after going wide. If they react to ideas, generate a new round in that direction.

## Gotchas

- Twenty ideas that are all the same idea reworded is a failure. Check that each angle produced something different.
- Repeating earlier ideas when the user asks for "more" wastes the round. Move in the direction they pointed.
- Names that look good on screen can be hard to say, easy to misspell, or already registered. Check before recommending.
- Narrowing too early kills the odd ideas that sometimes turn out best. Keep the two phases apart.

## Output

A grouped list of ideas, one line each. When narrowing, add the criteria, the top three with their strongest argument and biggest risk, and one suggested next step.
