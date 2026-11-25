---
name: product-description
description: Writes product descriptions from supplied specifications, saying what the item is, who it suits and the facts a buyer checks before purchase, in the shop's voice and without invented claims. Use when the user asks for a product description, product page copy, or text for items in a shop or catalogue.
---

# Product description

## Goal

A description that helps a buyer decide and cuts returns. A good result leads with what the product is, gives accurate specifications in a scannable form, says who it is for and who it is not for, and uses no claim the user did not supply.

## When to use

- One product or a batch of products needs page copy.
- Existing descriptions are all adjectives and no facts.
- For ad copy or campaign messaging, that is a marketing task, not this skill.
- For a short headline or title for the listing, use `use_skill` with `headline-writer`.

## Steps

1. Collect the facts. `read_file` any spec sheet, CSV or supplier text; for a batch, read the whole file once so the structure is known. Ask with `ask_user` for anything essential that is missing: dimensions, materials, capacity, compatibility, care instructions, what is in the box, warranty.
2. Ask who buys it and how they search: the audience, the shop's voice (sample page if available) and any keywords the shop uses. Match an existing page's length and layout.
3. Write the opening sentence: the product's name, what it is, and its main use, in plain words. A buyer scanning should know the category at once.
4. Add two to four sentences on use: who it suits, the situations it handles, and what makes it different from the obvious alternative, drawn only from the specs. Convert a feature into a consequence the buyer can check ("holds 1.5 litres" and not "generous capacity").
5. List the specifications as short label and value lines: size, weight, materials, colours, compatibility, included items. Keep units consistent across a batch.
6. State limits honestly: what it does not do, sizing notes, assembly or maintenance needs. This lowers returns and complaints.
7. For a batch, vary the wording by product facts, not by shuffling adjectives. Two products that differ in one spec should differ in that line, and share the rest honestly.
8. Check every claim against the source. Remove anything not supplied: certifications, "waterproof", "eco-friendly", "handmade", prices, delivery promises. For regulated categories such as food, cosmetics or electronics, the claims allowed vary by country; tell the user to check them before publishing.
9. Output in the format the shop needs (plain text, HTML or CSV columns). Save with `create_file` for batches.
10. Write a short version (one or two lines) for listings and cards, drawn from the same facts as the long one.
11. Suggest alt text for product images only from what the user says the images show.

## Gotchas

- An invented spec causes real harm: wrong sizes, wrong materials and refunds. If a value is missing, leave a marked gap and ask.
- "High quality", "premium" and "perfect" tell the buyer nothing. Replace each with the fact behind it or delete it.
- Copying the supplier's text unchanged duplicates what other shops publish, which weakens search ranking. Rewrite from the facts.
- A batch written from one template reads as one; shoppers comparing two pages notice. Let the real differences shape the text.
- Unit mix-ups (cm and inches, grams and ounces) cost sales. Choose the units the audience uses and convert exactly, or give both.
- Safety and compliance statements are not copy to improvise. Use only supplied text.
- Comparisons with a named competitor invite disputes. Compare to a category or a previous model.
- Size charts differ by maker. State which standard a size follows and give measurements if available.
- Reviews and ratings are not copy. Quote one only with the reviewer's permission and its date.
- Colour names vary between screens and makers. Use the supplier's name and mention that shades can differ.
- Do not state stock, price or delivery in the description; those change and belong to the shop system.

## Output

- The description for each product in the requested format.
- A list of gaps: specs missing, claims you removed, items needing a compliance check.
- For batches, a table of product, filled fields and open questions.
