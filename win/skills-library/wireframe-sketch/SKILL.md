---
name: wireframe-sketch
description: Sketches low-fidelity wireframes as text or simple SVG with labelled regions, content priority, navigation and the empty, loading and error states of a screen. Use when the user asks to wireframe a screen, sketch an app layout, or draw the structure of a page before visual design.
---

# Wireframe sketch

## Goal

Agree on structure and priority before color and fonts enter the conversation. The result is a set of grey-box layouts that show what goes where, what each element does and how the user gets from one screen to the next.

## When to use

- The user describes an app, page or flow and wants to see a layout.
- A team argues about what belongs on a screen and needs something to point at.
- For polishing an existing visual design, use `use_skill` with `design-critique`.
- For building the screen in code once approved, continue with the project's normal implementation skills.

## Steps

1. Ask with `ask_user` who uses the screen, the main task they came to do, the device (phone, desktop or both) and what data appears. Ask for existing screens or a similar product the user likes.
2. List the content and actions on the screen, then rank them: primary action, secondary, supporting information. Drop anything that does not serve the main task or move it to another screen.
3. Choose the pattern: list and detail, form, dashboard, feed, wizard, settings. Use a known layout unless there is a reason not to.
4. Draw it. For a quick sketch use a fixed-width ASCII block with boxes, labels like `[Search]`, `[ Primary button ]`, `(image)` and `----` for text lines. For a shareable file, write a small SVG with `create_file`: grey rectangles, one stroke weight, labels in a single font, no color except one highlight for the primary action.
5. Add annotations as numbered notes: behavior on click, data source, validation rule, what happens when the list is empty.
6. Sketch the states that people forget: empty, loading, error, partial data, long text, and a first-visit version. A short note is enough where the layout does not change.
7. Draw the flow as a list of screens with the action that links each pair, and ask the user to confirm before refining anything.
8. Walk the main task through the wireframes step by step and count the taps or clicks. If it takes more than the user expects, merge screens or move an action.
9. Mark which parts are fixed by the platform (system dialogs, browser chrome, native pickers) so nobody draws what cannot be changed.

## Gotchas

- Real-looking copy distracts reviewers into wording. Use labels such as "Heading" and "Item name".
- Wireframes for desktop do not scale to phone by shrinking. Draw the narrow version separately, or state the stacking order.
- Putting every feature on the first screen hides the primary action. Cut until one thing stands out.
- Do not add decoration, gradients or brand color. That moves the discussion to style too early.
- Without sizes, designers guess touch targets. Note that tap areas need comfortable size.
- Navigation drawn differently on each screen suggests the structure is not decided. Fix one global pattern first.
- Hidden gestures (swipe, long press) need a visible alternative for people who do not find them.

## Output

- The task walkthrough count, for example "five taps to finish".
- One sketch per screen, with numbered annotations beneath.
- A state list and a flow list.
- Open questions for the user, and the saved file path if one was created.
