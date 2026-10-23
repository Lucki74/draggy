---
name: forms-accessibility
description: Fixes labels, grouping, error messages, required markers and focus handling in forms so screen reader and keyboard users can complete them. Use when the user asks to make a form accessible, asks about screen reader labels, or wants form errors announced.
---

# Forms accessibility

## Goal

Every control has a programmatic name, every error is tied to its field and announced, and the whole form can be completed by keyboard. A good result is verified in the accessibility tree and not by looking at the page alone.

## When to use

- A form fails a screen reader or keyboard check.
- The user asks for correct labels, error semantics or fieldset grouping.
- For the broader page audit, use `use_skill` with `accessibility`.
- For validation timing and wording, use `use_skill` with `form-validation-ux`.
- A form fails an accessibility audit or a legal compliance review.
- A multi-step form or wizard needs progress and step announcements.

## Steps

1. Read the form markup with `read_file`, or open the live page with `browser_navigate` and capture the accessibility tree with `browser_snapshot`. List each control and its accessible name as the tree shows it.
2. Give every control a visible `<label>` linked by `for` and `id`, or wrapping the control. Use `aria-label` only where no visible text can exist.
3. Group related controls (radio sets, address blocks) in a `<fieldset>` with a `<legend>`.
4. Use the right input `type`, `autocomplete` tokens and `inputmode` so browsers and assistive tech can help.
5. Mark required fields with the `required` attribute, and state the convention in visible text. Add `aria-invalid="true"` on fields that currently fail.
6. Tie errors to fields with `aria-describedby` pointing to the message element's id. Place a short error summary at the top that links to each field, and move focus to it or to the first invalid field after a failed submit.
7. Announce dynamic messages with a live region (`role="alert"` for blocking errors, `aria-live="polite"` for status). Make sure the region exists in the DOM before its text changes.
8. Test with `browser_press_key` for Tab, Shift+Tab, Space and Enter through the full form, then re-read the tree with `browser_snapshot`. Fix with `edit_file`.
9. For multi-step forms, expose progress as text (step 2 of 4), move focus to the new step heading on change, and keep earlier answers reachable.
10. Check touch and pointer needs: targets large enough, labels that are clickable, and no drag-only input without an alternative.

## Gotchas

- A placeholder is not a label. It vanishes on input, often has poor contrast and is not reliably announced as a name.
- An error message rendered next to a field but not linked by `aria-describedby` is invisible to a screen reader moving through controls.
- Injecting a live region and its text in the same update is often not announced. Render the empty region first.
- `disabled` buttons drop out of the tab order and give no reason. Prefer an enabled button that explains the problem on activation.
- Custom selects and date pickers rebuilt from divs lose native keyboard and name support. Prefer native controls unless a tested component is available.
- Moving focus on every keystroke error traps users. Move focus only on submit or on explicit navigation.
- Required asterisks alone are not read reliably. Say "required" in text or rely on the `required` attribute with an explanation.
- Auto-advancing focus after a fixed number of characters (phone and card fields) breaks screen reader and correction flows. Avoid it.
- Time limits on forms need warnings and extension. A session that silently expires loses a long entry.

## Output

- A list of defects with element, rule broken and the fix applied.
- The corrected markup for the main patterns used (label, group, error link).
- What you verified through the tree and keyboard, and what needs a real screen reader pass.
- State the standard or level you checked against only if the user named one.
