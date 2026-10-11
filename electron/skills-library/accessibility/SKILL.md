---
name: accessibility
description: Audits and fixes web interfaces for accessibility (semantic HTML, keyboard use, focus, labels, contrast, ARIA used correctly, screen reader announcements) against WCAG 2.2 AA. Use when the user asks for an accessibility review, a11y fixes, or to make a component usable with a keyboard or screen reader.
---

# Accessibility

## Review the code for

1. **Semantics:** real `button` for actions and `a href` for navigation (not clickable divs), headings in order, landmarks (header, nav, main), lists as lists, tables with th and scope.
2. **Names and labels:** every input has a visible label tied to it (label for / aria-labelledby); icon-only buttons have an accessible name (aria-label); images have meaningful alt, and decorative ones `alt=""`.
3. **Keyboard:** everything usable with Tab, Shift+Tab, Enter, Space and Escape; logical focus order; no keyboard traps; custom widgets (menus, tabs, dialogs, comboboxes) follow the ARIA Authoring Practices keyboard patterns.
4. **Focus:** visible focus styles (never `outline: none` without a replacement), focus moved into dialogs on open and returned on close, focus managed after route changes.
5. **ARIA:** only when native HTML cannot do it; correct roles, states (aria-expanded, aria-selected, aria-checked) kept in sync; no aria-hidden on focusable elements.
6. **Dynamic content:** errors and status messages announced (aria-live="polite", role="alert" for urgent errors); loading states communicated.
7. **Forms:** errors linked to fields (aria-describedby), not signalled by colour alone, required fields marked in text.
8. **Visual:** text contrast at least 4.5:1 (3:1 for large text and UI components), content readable at 200% zoom and 320 px width, no information conveyed by colour only, motion respects prefers-reduced-motion.
9. **Media:** captions for video, transcripts for audio, no autoplay with sound.

## Tools

If the project has them, run automated checks with run_command (eslint-plugin-jsx-a11y, axe via Playwright or jest-axe tests, pa11y, Lighthouse CLI). Automated tools catch only part of the problems; still review the items above by reading the components.

## Fix

Prefer native elements over ARIA patches. Make fixes with edit_file in the project's component style, and add tests (for example testing-library queries by role and name) where the project has component tests.

## Report

Issues grouped by severity (blocks use, makes use hard, minor), each with the WCAG criterion, file and line, who is affected, and the fix. Then the changes made, if any.
