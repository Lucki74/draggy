---
name: xss-csp-review
description: Finds cross-site scripting risks in templates and front-end code (unescaped output, unsafe HTML sinks, URL and attribute contexts), fixes them with contextual encoding or sanitisation, and builds a Content Security Policy in report-only mode first. Use when the user asks to check for XSS, render user supplied HTML safely, or write a CSP.
---

# XSS and CSP review

## Goal

Make sure user controlled text can never run as script in another user's browser.

A good result fixes the cause with correct output encoding, and adds a CSP as a second layer.

## When to use

- The app displays user content: comments, names, rich text, markdown, search terms.
- A scanner or pentest reported reflected or stored XSS.
- The team wants a CSP deployed without breaking pages.
- For the other response headers, use `use_skill` with `security-headers`.

## Steps

1. Find the sinks with `search_files`: `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `dangerouslySetInnerHTML`, `v-html`, `[innerHTML]`, `|safe`, `raw`, `eval(`, `new Function(`, `setTimeout("`.
2. For each sink read the code with `read_file` and trace the value to its origin. Mark user, database, URL parameter or hardcoded.
3. Prefer safe APIs: `textContent`, framework default escaping, and `setAttribute` for known attributes. Replace with `edit_file`.
4. If HTML must be rendered (rich text, markdown), sanitise on output with a maintained sanitiser such as DOMPurify configured with an allow list. Check its current docs with `read_url`.
5. Check URL contexts: `href` and `src` from users must be restricted to `https:`, `http:` and `mailto:`. A `javascript:` URL runs on click.
6. Check attribute and script contexts: never place user data inside inline event handlers, `<script>` blocks or `style` without the correct encoding for that context.
7. Check cookies set `HttpOnly` so script cannot read the session even if XSS occurs.
8. Draft a CSP: `default-src 'self'`, explicit `script-src` with nonces or hashes, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors`, and `form-action`.
9. Remove inline scripts and handlers so the policy needs no `'unsafe-inline'` for scripts. Use per-response nonces generated with a secure random source.
10. Deploy as `Content-Security-Policy-Report-Only` first with a report endpoint, review the violations for a few days, then enforce.
11. Add a test that stores `<img src=x onerror=...>` style content and asserts it renders as text.
12. Report each sink as fixed, safe with reason, or open.

## Gotchas

- A CSP with `'unsafe-inline'` or `'unsafe-eval'` for scripts gives little protection. It reduces damage only if script execution is controlled.
- Encoding must match the context: HTML text, attribute, URL, JavaScript and CSS each need different handling.
- Sanitising on input and trusting it everywhere later breaks when the same data feeds a different context. Encode at output.
- Frameworks escape by default, and the escape hatches (`dangerouslySetInnerHTML`, `v-html`) are the places to search.
- DOM XSS reads `location.hash` or `document.referrer` and never touches the server, so server templates look clean.
- Allowing a whole CDN host in `script-src` may allow attacker-hosted files on the same host. Use nonces or hashes.

## Output

- A sink table: location, source, context, fix.
- The proposed CSP header with a one-line reason per directive and the rollout plan in report-only mode.
- Tests added.
