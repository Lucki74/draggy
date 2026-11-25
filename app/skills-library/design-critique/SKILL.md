---
name: design-critique
description: Critiques one design against its stated goal and audience, in ranked actionable points that separate problems from taste. Use when the user asks for design feedback, a critique of a layout or mockup, or what is wrong with a design.
---

# Design critique

## Goal

Give feedback the designer can act on. Each point ties back to what the design is supposed to do and for whom, so the critique judges effectiveness, not personal preference.

## When to use

- The user shares a screenshot, mockup, page URL or exported file and asks for feedback.
- The user feels something is off and cannot say what.
- For slides use `use_skill` with `slide-design-review`. For a coded interface with accessibility concerns, use `use_skill` with `accessibility`.

## Steps

1. Look at it. Use `read_file` for an image, or `browser_navigate` then `browser_screenshot` for a live page. Take the mobile width too when the design is responsive with `browser_snapshot` or a resized capture. State what you could not see.
2. Ask with `ask_user` for the goal (what action or feeling), the audience, the context of use and any constraints already fixed such as a brand font. If the user refuses to say, state your assumed goal and ask them to correct it.
3. Give a first impression in one line before analysis: what you notice first, and what you think the design is about. Compare it with the intended goal.
4. Review in layers: purpose and message, hierarchy (what is read first, second, third), layout and spacing, type, color, imagery, consistency, and states or flows if more than one screen.
5. Write each finding as: what you see, why it matters for the goal, and a concrete change. Mark strong parts with the same format, because designers need to know what to keep.
6. Rank into three groups: blocks the goal, weakens the goal, polish. Merge repeated issues.
7. Mark taste calls as taste ("I would try a warmer accent, though this is preference") and keep them in a separate short list.
8. Check your own critique before sending: does each point name an element, a reason and a change? Remove any that say only "feels off" or "needs more polish".
9. Close by asking which finding the designer disagrees with and why. Their answer often reveals a goal you had not been told.

## Gotchas

- Feedback without the goal turns into "I'd do it differently". Anchor each point.
- Listing twenty issues buries the three that matter. Cap the main list at five to seven.
- Do not redesign it in text. Suggest direction, and offer a sketch only if asked.
- A screenshot hides interaction. Do not claim a hover or flow works.
- Praise that is vague ("nice clean look") helps no more than vague criticism. Name the specific element.
- Comparing with a famous product is not a reason. Say what that product does that this design lacks.
- A critique of work in progress should not judge details that the designer has marked as placeholders.

## Output

- A final line with the one change that would improve the design most.
- One-line first impression and the assumed goal.
- Ranked findings with see, matters, change.
- What to keep, a short taste list and what was not reviewed.
