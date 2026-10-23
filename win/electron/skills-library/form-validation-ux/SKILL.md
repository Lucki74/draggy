---
name: form-validation-ux
description: Designs when and how a form validates, what its errors say and how it recovers from failure, then implements it. Use when the user asks to improve form validation, says form errors are annoying, or asks when errors should appear.
---

# Form validation UX

## Goal

A user who makes a mistake sees one clear message next to the field, fixes it quickly and loses nothing already typed. A good result validates at the right moment, matches client rules to server rules and keeps the form usable on failure.

## When to use

- The user asks about validation timing, error wording or submit behaviour.
- Users abandon a form or complain about errors appearing too early.
- For screen reader and label problems in the same form, use `use_skill` with `forms-accessibility`.
- For wording page-level failure and empty views, use `use_skill` with `loading-and-empty-states`.
- Sign-up or checkout conversion is low and the form is suspected.
- A form needs conditional fields that appear based on earlier answers.

## Steps

1. Read the form component and its submit handler with `read_file`. List each field, its rules, where the rules are enforced (client, server or both) and how errors are shown.
2. Check what the server returns on invalid input using `search_files` for the handler. The client must be able to map a server error to a field.
3. Choose timing per field. Validate on blur for most fields, and revalidate on every change once a field has shown an error. Validate the whole form on submit and move focus to the first invalid field.
4. Write messages that say what to do: "Enter an email like name@example.com", not "Invalid input". Put each message directly under its field.
5. Keep the user's data. On a failed submit do not clear fields, and do not disable the submit button without saying why.
6. Mark required and optional fields in the label, and put format hints before the input and repeat them in the error.
7. Handle the submit lifecycle: disable double submit, show progress, and display a form-level message for errors that belong to no single field, such as a network failure.
8. Exercise it with `browser_type` and `browser_click` on the running page: empty submit, one bad field, a server rejection and a successful submit. Fix what you find with `edit_file`.
9. Check conditional fields: hidden fields must not be validated or submitted, and their stale values must be cleared when hidden.
10. Test the keyboard path with `browser_press_key`: Enter submits once, Tab order matches visual order, and Escape does not discard typed data.

## Gotchas

- Validating on the first keystroke flags "invalid email" before the person finished typing. Wait for blur, then switch to live checks.
- Client rules that are stricter than the server reject valid input, and the reverse lets bad data through. Rules like name length and email shape need one source of truth.
- Rejecting valid unusual input is a common bug: plus signs in emails, apostrophes and spaces in names, long postal codes. Do not over-restrict.
- An error shown only in red fails for color-blind users. Pair it with text and an icon or prefix.
- Autofill and paste can set a value without firing the events your validation listens to. Test both.
- Password rules shown only after failure frustrate people. State them before the field.
- Disabling the submit button until the form is valid leaves users guessing what is wrong. Allow submit and show what needs fixing.
- A confirm-email field mostly adds typos from retyping and slows people down. Prefer a visible show-password toggle or a verification step.
- Trimming whitespace and normalizing case on the client but not on the server leads to duplicate accounts. Normalize in both places.

## Output

- A short spec: for each field, the rule, the timing and the message text.
- The code changes, or a plan if the user only asked for advice.
- The scenarios you tested and any you could not, such as real server responses.
- Call out any rule that you could not match against the server and who should confirm it.
