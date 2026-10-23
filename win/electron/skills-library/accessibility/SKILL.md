---
name: accessibility
description: Audits and fixes web interfaces for accessibility against WCAG 2.2 AA, covering semantic HTML, keyboard use, focus, labels, contrast, correct ARIA and screen reader announcements. Use when the user asks for an accessibility review, a11y fixes, or to make a component work with a keyboard or screen reader.
---

# Accessibility

## Goal

Find the barriers that stop people using the interface with a keyboard, a screen reader, zoom or low vision, and fix them with native HTML wherever possible. A good result lists each issue with its WCAG criterion and affected users, and leaves the code fixed and tested.

## When to use

- The user asks for an accessibility or a11y review of a page or component.
- A widget (menu, tab set, dialog, combobox) must work by keyboard or with a screen reader.
- The user wants a WCAG 2.2 AA check before release.
- For a general code review that is not about accessibility, use `use_skill` with `code-review`.

## Steps

1. Find the UI code with `search_files` and `read_file`. Note the framework, the component style and whether the project has component tests.
2. If the project has them, run automated checks with `run_command`: eslint-plugin-jsx-a11y, axe through Playwright or jest-axe tests, pa11y, or the Lighthouse CLI.
3. Review the code against this list, even when the tools pass:
   - **Semantics:** a real `button` for actions and `a href` for navigation, headings in order, landmarks (header, nav, main), lists as lists, tables with `th` and `scope`.
   - **Names and labels:** every input has a visible label tied to it (`label for` or `aria-labelledby`). Icon-only buttons have an accessible name (`aria-label`). Images have meaningful alt text, and decorative ones use `alt=""`.
   - **Keyboard:** everything works with Tab, Shift+Tab, Enter, Space and Escape. Focus order is logical, nothing traps focus, and custom widgets follow the ARIA Authoring Practices keyboard patterns.
   - **Focus:** visible focus styles, focus moved into a dialog on open and returned on close, focus managed after route changes.
   - **ARIA:** used only where native HTML cannot do the job. Roles are correct and states (`aria-expanded`, `aria-selected`, `aria-checked`) stay in sync with the UI.
   - **Dynamic content:** status messages and errors are announced (`aria-live="polite"`, or `role="alert"` for urgent errors). Loading states are communicated.
   - **Forms:** errors are linked to their fields with `aria-describedby`, are not shown by colour alone, and required fields are marked in text.
   - **Visual:** text contrast of at least 4.5:1 (3:1 for large text and UI components), content readable at 200% zoom and 320 px width, motion that respects `prefers-reduced-motion`.
   - **Media:** captions for video, transcripts for audio, no autoplay with sound.
4. Fix with `edit_file`, in the project's component style. Prefer a native element over an ARIA patch.
5. Where the project has component tests, add some that query by role and name (for example testing-library), then run them with `run_command`.

## Gotchas

- Automated tools catch only part of the problems, so a clean axe run is not a pass. Still read the components.
- `outline: none` without a replacement focus style removes the only cue keyboard users have.
- `aria-hidden` on a focusable element leaves a control that can take focus but has no name.
- ARIA roles without the matching keyboard behaviour are worse than plain HTML. A `role="button"` on a div needs Enter and Space handling, and a native `button` already has it.
- Colour-only signals (red border for an error, green for success) fail people with colour blindness. Add text or an icon.

## Output

Issues grouped by severity (blocks use, makes use hard, minor). Each one gives the WCAG criterion, file and line, who is affected, and the fix. Then list the changes made, if any, and the tests run.
