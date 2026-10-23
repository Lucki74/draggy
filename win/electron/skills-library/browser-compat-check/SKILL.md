---
name: browser-compat-check
description: Decides whether a CSS, HTML or JavaScript feature is safe for a project's target browsers using live support data, and picks a fallback or polyfill when it is not. Use when the user asks if something works in Safari or older browsers, whether they can use a CSS feature, or to check browser compatibility.
---

# Browser compatibility check

## Goal

Answer "can we ship this" from current data and the project's real audience. A good result states the support picture, names the browsers that fail, and gives one recommendation: use it, use it with a fallback, or avoid it.

## When to use

- The user asks whether a specific feature works across browsers.
- Code uses a new API or CSS feature and the support is unknown.
- For layout that breaks on one browser only, use `use_skill` with `css-layout-debugging`.
- For Core Web Vitals problems rather than support, use `use_skill` with `web-vitals-fix`.
- Support requests come from one specific browser or device.
- A dependency upgrade may have raised the minimum browser versions.

## Steps

1. Pin down the target. Look for a `browserslist` entry in `package.json` or a config file with `search_files`, and for any support policy in the docs. If none exists, ask with `ask_user` which browsers and versions matter.
2. Name the exact feature, not the topic: the property and value, the API method, or the HTML attribute.
3. Look up current support. Use `read_url` or `search_web` on a maintained compatibility source such as MDN or caniuse. Do not answer from memory, since support changes every release.
4. Compare the data with the target list. Note the first version that supports the feature, partial support notes, and flags or prefixes required.
5. Check the project's tooling: does the transpiler or autoprefixer already handle it? Read the build config with `read_file`.
6. Choose a strategy. If the feature is purely visual, let it degrade. If the page breaks without it, provide a fallback, use feature detection (`@supports` or checking the API exists), or add a polyfill from a maintained source.
7. If the code is already written, find every use with `search_files` and write the guarded version with `edit_file`.
8. If the page can run, confirm in the available browser with `browser_navigate` and note you tested only that engine.
9. For JavaScript, check both syntax (transpiled by the build) and runtime APIs (not transpiled), because only the first is handled by compilers.
10. Record the answer with the date and sources in the PR or notes so the question does not get re-researched next quarter.

## Gotchas

- Memory is stale. A feature that was Chrome-only last year may be everywhere now, or the reverse for a dropped one.
- "Supported" in a table can hide partial support such as missing sub-features or a buggy first release. Read the notes.
- Safari on iOS tracks the OS version, so older devices stay on old engines. Check iOS version share for the audience before dropping it.
- Polyfilling something that degrades gracefully only adds weight. Decide whether the missing feature hurts function or only polish.
- `@supports` tests a property, not that the implementation is bug-free. Known bugs need their own workaround.
- A fallback that is never tested rots. Say how it was verified or mark it untested.
- Syntax support and API support are different problems. Optional chaining is compiled away, but a missing runtime method is not.
- Enterprise and embedded webviews lag far behind the browser they are named after. Ask whether the app runs in one.
- Vendor prefixes added by a tool may be stale. Check that the build's browser target list is current.

## Output

- A one-paragraph verdict: ship, ship with fallback, or avoid.
- A small table: browser, first supporting version, notes.
- The fallback code or detection snippet, and the sources used with the date checked.
- Say clearly when the answer depends on a policy decision the user has to make, such as dropping an old browser.
