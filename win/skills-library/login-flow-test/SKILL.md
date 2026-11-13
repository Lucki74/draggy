---
name: login-flow-test
description: Walks a sign-in flow in the browser to check page structure, labels, links, error messages, redirects and console errors, while the user enters any credentials personally. Use when the user asks to test a login page, check the sign-in flow, or confirm that login redirects work.
---

# Login flow test

## Goal

Check everything about a sign-in flow that does not need a secret typed by the agent: the page loads, the fields are labelled, the links go to the right places, errors read well, and redirects land correctly. The agent never types a password, code or token.

## When to use

- The user is building or reviewing a login or sign-up page and wants a live check.
- A redirect after sign-in or sign-out seems wrong.
- For other forms on the site, use `use_skill` with `form-validation-test`.
- For a security review of the code behind sign-in, use `use_skill` with `auth-flow-review`.

## Steps

1. Ask with `ask_user` for the address, which environment it is (local, staging or production), and what the flow should do after sign-in. If it is production, test only what is safe without an account: structure, links and empty-field messages. Do not make repeated attempts on a live account.
2. Open the page with `browser_navigate`. Use `browser_snapshot` to list fields, labels, buttons, links such as "forgot password" and "sign up", and any social sign-in buttons. Check each input has a visible label, a sensible type and an autocomplete hint.
3. Check the console with `browser_console` after load for errors and warnings, such as blocked scripts, mixed content or failed requests.
4. Test empty submission by clicking the submit button with the fields empty. Read the message with `browser_get_text`. Check that it names the problem, is shown near the field, and does not reveal whether an account exists.
5. Test a malformed email address with an obviously fake value such as `not-an-email`. This is a test of format validation and carries no secret. Do not type anything into a password field.
6. Ask the user to enter their own credentials in the browser when you need to go further. Wait for them to say it is done. Then take a `browser_snapshot` and check where the redirect lands, that the user's name or menu shows, and that the address has no tokens in the query string.
7. Check the surrounding behaviour: the "forgot password" page opens and asks for an email only, sign-out returns to a sensible page, and pressing back after sign-out does not show private pages. Use `browser_history` where available.
8. Check links open the right pages with `browser_click` and `browser_tabs`, including terms and privacy links.
9. Write the findings with the steps to reproduce each one.
10. Close the browser session with `browser_close` and remind the user to sign out of anything they signed into for the test.

## Gotchas

- Repeated wrong attempts can lock an account or trigger alerts. Keep to one or two safe failures.
- Never type test credentials from memory or from a seed file into a site that is not clearly the user's own local or staging app.
- Error messages that say "no account with that email" help attackers. Flag them.
- Some sign-in pages hide the form in an iframe or a pop-up. Snapshot again after clicking the sign-in button.
- Two-factor prompts, CAPTCHAs and email links are for the user to complete. Stop and ask.
- Do not paste URLs that contain tokens into the report. Replace them with a placeholder.
- Password managers may fill the form on their own. Tell the user before you click into a field.
- A "remember me" box that is ticked by default is worth a note on shared computers.

## Output

- A reminder of anything the user should sign out of or clear.
- A checklist of what passed, what failed and what could not be tested without credentials.
- Each failure with steps to reproduce and the text observed.
- The redirect path seen after the user signed in, with tokens removed.
