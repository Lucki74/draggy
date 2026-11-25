---
name: meal-planner
description: Plans meals for a week or more around diets, allergies, budget, cooking time and leftovers, with recipe outlines and a shopping list grouped by aisle. Use when the user wants a meal plan, weekly menu, batch cooking plan or shopping list, or asks what to cook this week.
---

# Meal planner

## Goal

A realistic menu the household can cook with the time and money they have, little waste, and a shopping list that excludes what they already own.

## When to use

- The user wants a meal plan, weekly menu, batch cooking plan or shopping list.
- For a single recipe or cooking question with no plan around it, answer directly.
- For a food budget across a month, use `use_skill` with `budget-planner`.

## Steps

1. Collect: number of people and meals per day to plan, dietary needs and allergies (treat allergies as strict), dislikes, budget, cooking time per meal on weekdays and weekends, equipment, and what is already in the fridge or cupboard. Ask for what is missing with `ask_user`.
2. Plan with these principles:
   - Reuse ingredients across meals to cut waste and cost: roast chicken Monday becomes wraps Tuesday.
   - Batch cook once or twice a week if the user has little weekday time.
   - Balance each day roughly: protein, vegetables, a starch or whole grain, and variety across the week.
   - Put quick meals (under 30 minutes) on busy days.
   - Use seasonal and affordable produce when budget matters.
3. Write the output parts below.
4. Offer to save the plan as a .pdf and the shopping list as an .xlsx with `create_file`.

## Gotchas

- Allergies are not preferences. One missed ingredient in a sauce or stock can be harmful, so check every recipe.
- For medical diets (diabetes, kidney disease, severe allergies), give general guidance only and suggest confirming with a dietitian.
- A shopping list that repeats what the user already has wastes money. Subtract their stock.
- A plan that ignores weekday time gets abandoned by Wednesday.

## Output

1. A week table: day by meal, each with a dish name and prep time.
2. For each dish, a short recipe outline: ingredients with quantities for the number of people, and 3 to 6 steps. Skip outlines for trivial meals.
3. A prep plan: what to cook ahead and when.
4. A shopping list grouped by section (produce, meat and fish, dairy, bakery, dry goods, frozen, other), with total quantities, excluding what the user already has.
