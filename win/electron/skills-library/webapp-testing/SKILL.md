---
name: webapp-testing
description: Tests a web app running on the user's machine by driving it with the browser tools, then checks page text, console errors and layout against what the app should do. Use when the user asks to test their local site, click through the app, or check a page for errors.
---

# Web app testing

## Goal

Check that a locally running web app behaves as intended by using it the way a person would, and report what passed, what failed and the evidence for each. The result is a list of checked flows with exact failures, not a guess from reading code.

## When to use

- The user has a dev server and wants a flow tried in the browser.
- A UI bug needs a live look: console errors, wrong text, broken layout.
- A change needs a smoke test before it is called done.
- A fix to the UI needs a quick check that the page still loads and works.
- The user reports a visual or console problem on their own machine.
- A form or checkout flow needs trying with bad input.

Not for planning which flows deserve automated tests (use `use_skill` with `e2e-test-plan`) or for scraping other people's sites (use `browser-tasks`).

## Steps

1. **Find the address.** Read the project scripts with `read_file` (package.json) and check whether the server is up with `run_command`. If it is not, start it with `run_command` in the background and wait for the ready line. Use `ask_user` when the port or login is unknown.
2. **List the checks.** Write 3 to 8 flows with expected results in `update_plan`: page loads, main action works, form shows an error for bad input, back and reload behave.
3. **Open the page.** Call `browser_navigate`, then `browser_snapshot` to see the element tree. Prefer snapshot refs over guessed positions.
4. **Run each flow.** Use `browser_click`, `browser_type`, `browser_press_key` and `browser_select_option`. After each action call `browser_wait` for the expected element or text, then `browser_get_text` to read the result.
5. **Read the console.** Call `browser_console` after every flow and not once at the end. Note errors, failed requests and warnings with the step that caused them.
6. **Check layout.** Take `browser_screenshot` at the main states. Look for clipped text, overlap and empty areas. Resize the window if the tool allows it and repeat for a narrow width.
7. **Try the odd inputs.** Empty fields, a very long value, double click on submit, reload mid-flow.
8. **Close up.** Call `browser_close` if you opened the session, and stop any server you started.
9. Report anything you could not test, such as login behind a provider, instead of skipping it quietly.

## Gotchas

- Asserting right after a click reads the old state. Wait for the new text or element first.
- A stale dev server or cached bundle shows old code. Reload hard after an edit and confirm the change is live.
- A screenshot can look right while the console shows errors, and the reverse. Use both.
- Test data created by your clicks stays in the app. Name it clearly and tell the user.
- Never type real credentials. Use test accounts the user gave or the project seeds provide.

## Output

A table or list: flow, expected, actual, pass or fail, with console lines and screenshot notes for failures. End with the most likely cause for each failure and the file to look at, when known.

Do not leave browser tabs or dev servers running that you started.
