---
name: keyboard-navigation-test
description: Walks a page using only keyboard input, checking tab order, visible focus, operability of widgets, focus traps and focus return, and reports each failure. Use when the user asks to test keyboard navigation, whether a page works without a mouse, or to check tab order.
---

# Keyboard navigation test

## Goal

Prove that every action available to a mouse user can be done from the keyboard, in a sensible order, with focus always visible. A good result is a list of failures tied to elements, each with the key sequence that shows it.

## When to use

- The user asks if a page or flow is usable without a mouse.
- A modal, menu, tab set or custom widget was added or changed.
- For form-specific naming and error semantics, use `use_skill` with `forms-accessibility`.
- For a full audit beyond keyboard use, use `use_skill` with `accessibility`.
- A custom dropdown, date picker, drag-and-drop list or tree was built from scratch.
- A release checklist asks for keyboard coverage evidence.

## Steps

1. Define the flows to test: the main task a visitor does, plus every overlay, menu and form on the page. Ask with `ask_user` if the page is large.
2. Open the page with `browser_navigate`. Start from the top and press Tab with `browser_press_key`, taking a `browser_screenshot` or `browser_snapshot` every few presses to see where focus is.
3. Record the order. It should follow the visual and reading order. Note elements that are skipped, visited twice or reached out of order.
4. Check visibility: each focused element needs a clear focus indicator with enough contrast. Flag any `outline: none` without a replacement, found with `search_files`.
5. Operate widgets: Enter or Space for buttons and links, arrow keys inside menus, tabs, radio groups and listboxes, Escape to close overlays.
6. Test overlays: focus moves into a dialog on open, stays inside while open, and returns to the trigger on close. Content behind should not be reachable.
7. Look for traps and dead ends: a widget that captures Tab with no exit, a hover-only menu, a skip link that is missing or broken, and page areas that scroll but cannot be focused.
8. Report, and fix with `edit_file` if asked, preferring native elements (`button`, `a`, `details`) over repaired divs.
9. Check shortcuts: single-key shortcuts must be remappable or only active on focus, and must not collide with browser or screen reader keys.
10. Check drag-and-drop and other pointer-heavy features for a keyboard alternative such as move up and down buttons.

## Gotchas

- A positive `tabindex` value jumps the element ahead of everything else and breaks natural order. Use 0 or -1 only.
- A `div` with a click handler is not focusable and ignores Enter and Space. Making it a real `button` fixes all three problems.
- Closing a modal that removes its trigger from the DOM leaves focus on the body. Return focus to a sensible nearby control.
- Arrow-key widgets should be one tab stop, with the arrows moving inside. Making every item a tab stop makes long lists painful.
- Focus styles hidden by `overflow: hidden` on a parent look like missing focus. Check that the outline is not clipped.
- Automated tools find few keyboard problems. This check needs real key presses and eyes on the focus ring.
- Focus trapped inside an iframe or embedded widget can strand a keyboard user. Test the exit path for every embed.
- Skipping to content needs a visible target. A skip link that moves nothing or points at a missing id looks right and does nothing.
- Dialogs built with the native element handle focus well. Custom ones often forget Escape and the inert background.

## Output

- A list of failures: element, key sequence, expected result, actual result, suggested fix.
- A short list of what passed, so the author knows what was covered.
- Flows not tested and why, for example browser tools unable to emulate a key.
- Give each failure a numbered key sequence so a developer can replay it without guessing.
