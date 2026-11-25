---
name: form-validation-test
description: Exercises a form that the user owns or has approval to test with empty, over-long, malformed and boundary inputs on a local or staging copy, records each response and avoids sending real or repeated submissions. Use when the user asks to test form validation, see what happens with bad input, or try edge cases on a form.
---

# Form validation test

## Goal

Find where a form accepts what it should reject or rejects what it should accept, and where the messages confuse people. Testing runs against a local or staging copy, never against a live endpoint that sends emails or stores records.

## When to use

- The user is building or reviewing a form and wants to see its behaviour.
- A bug report says a valid input is refused or a bad one slips through.
- For filling a form with real data, use `use_skill` with `web-form-fill-safe`.
- For the sign-in form specifically, use `use_skill` with `login-flow-test`.

## Steps

1. Confirm with `ask_user` that the form is the user's own or that they have approval to test it, and which environment it is. If it is a live production form that sends mail or writes records, do not submit. Test only client-side checks that fire before sending, and say what was left untested.
2. Open the page with `browser_navigate` and list the fields with `browser_snapshot`: label, type, required, limits, patterns. Read the form's source with `read_file` if the code is local, to compare the rules in the markup with the rules in the server code.
3. Write a test table with `update_plan`, one row per field: valid value, empty, whitespace only, too short, too long, wrong format, special characters, very large number or negative number, and a date at the boundaries.
4. Run the cases with `browser_type` and `browser_select_option`. Use clearly fake values such as `test@example.com` and invented names. Never enter real people's data, passwords or payment numbers.
5. After each case, read the outcome with `browser_get_text`: where the message appears, its words, whether the field is marked, whether focus moves to the first error and whether the entered values stay.
6. Check `browser_console` after each submit attempt for script errors or failed requests. If you can see network details in the console, note the status code the server returned.
7. Check keyboard use: tab order, submit with Enter, and error messages linked to their fields so a screen reader would announce them. Use `browser_press_key` for Tab and Enter.
8. Test once with the valid case, only on a test environment, to confirm the success state, and report the confirmation text.
9. Report each defect with the input, the expected result and the actual result.
10. Re-run the failed cases after the user fixes the form, and report which defects are closed and which remain.

## Gotchas

- Client-side checks can be skipped. A form that blocks bad input in the browser still needs the server to reject it, which this test may not reach.
- Repeated submissions to a form that sends mail can spam real inboxes. Use a test inbox or a staging setup that discards mail.
- Some validation depends on locale: phone numbers, postal codes, names with apostrophes or accents. Include them.
- Messages like "invalid input" give the person no way forward. Flag them.
- Disabling the submit button until everything is valid hides the reason. Check whether the form explains what is missing.
- Rate limits or CAPTCHAs may stop the test. Stop, and do not try to work around them.
- Pasting text can behave differently from typing, especially for input masks. Test both when masks exist.
- Autocomplete and browser autofill can bypass the patterns you tested. Note when they are in play.

## Output

- A suggested list of cases to turn into automated tests.
- A table of cases with input, expected, actual and pass or fail.
- Defects ranked by user impact.
- What was not tested and why: server rules, mail sending, uploads.
