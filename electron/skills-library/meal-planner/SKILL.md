---
name: meal-planner
description: Plans meals for a week or more around diets, allergies, budget, cooking time and leftovers, with recipes outlines and a shopping list grouped by aisle. Use when the user wants a meal plan, weekly menu, batch cooking plan or shopping list.
---

# Meal planner

## Collect

Number of people and meals per day to plan, dietary needs and allergies (treat allergies as strict), dislikes, budget, cooking time per meal on weekdays and weekends, equipment, and what is already in the fridge or cupboard.

## Principles

- **Reuse ingredients** across meals to reduce waste and cost: roast chicken Monday becomes wraps Tuesday.
- **Batch cook** once or twice a week if the user has little weekday time.
- **Balance** each day roughly: protein, vegetables, a starch or whole grain, and variety across the week.
- **Respect time:** quick meals (under 30 minutes) on busy days.
- **Seasonal and affordable** produce when budget matters.
- For medical diets (diabetes, kidney disease, severe allergies), give general guidance only and suggest confirming with a dietitian.

## Output

1. A week table: day × meal, each with a dish name and prep time.
2. For each dish, a short recipe outline: ingredients with quantities for the number of people, and 3 to 6 steps. Skip outlines for trivial meals.
3. Prep plan: what to cook ahead and when.
4. Shopping list grouped by section (produce, meat and fish, dairy, bakery, dry goods, frozen, other), with total quantities, excluding what the user already has.

Offer to save the plan as a .pdf and the shopping list as an .xlsx with create_file.
