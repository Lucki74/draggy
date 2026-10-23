---
name: security-headers
description: Audits the HTTP security headers a site sends (HSTS, content type, framing, referrer, permissions, cache control for private data) and sets a baseline in the app, proxy or CDN with a safe rollout. Use when the user asks to check or add security headers, fix a scanner grade, or harden a web server.
---

# Security headers

## Goal

Send the headers that tell browsers to apply protections, without breaking the site.

A good result is checked on the live response, applied at one layer, and rolled out in stages where a mistake is hard to undo.

## When to use

- A scanner or audit reports missing headers.
- A site is moving to HTTPS only.
- The user asks what a header does before adding it.
- For the CSP itself, use `use_skill` with `xss-csp-review`.

## Steps

1. Fetch the real headers with `run_command`: `curl -sI https://<host>/` and one API path. Record them as the baseline.
2. Find where headers are set now with `search_files` for `helmet`, `add_header`, `Header set`, `X-Frame-Options`, `Strict-Transport-Security` and middleware, and read the files.
3. Choose one layer to own the headers (app middleware, reverse proxy or CDN) so values do not duplicate or conflict.
4. Set `Strict-Transport-Security` with a short `max-age` first. Raise it after the whole site, including subdomains, works over HTTPS. Do not add `preload` until sure.
5. Set `X-Content-Type-Options: nosniff`, and correct `Content-Type` with charset on responses.
6. Set clickjacking protection with CSP `frame-ancestors` (and `X-Frame-Options` for old browsers) matching which sites may embed yours.
7. Set `Referrer-Policy` to a conservative value, and `Permissions-Policy` to disable features the app does not use.
8. Set `Cache-Control: no-store` on responses with private data, and keep the shared cache away from authenticated pages.
9. Remove headers that leak versions, such as `Server` details and `X-Powered-By`.
10. Check cookies' flags, and cross-origin isolation headers (`Cross-Origin-Opener-Policy`) only where needed. Verify names and values against MDN with `read_url` since browsers change.
11. Apply with `edit_file`, deploy to staging, and re-run the curl check on pages, API and static files, including error pages.
12. Report before and after and any header deliberately left out with the reason.

## Gotchas

- HSTS with a long age on a domain that still has an HTTP-only subdomain locks users out for months. Ramp up slowly.
- Headers set by both the app and the proxy appear twice, and browsers may take the stricter or ignore both.
- Error pages, redirects and static assets often miss headers that the main app adds. Test them.
- `X-XSS-Protection` is obsolete and can introduce problems; do not add it from an old checklist.
- A scanner grade is a prompt for thought, not the goal. A header that breaks login is worse than a missing one.
- `frame-ancestors` in CSP ignores some legacy behaviour, so confirm with a real embedding test.

## Output

- Before and after header table.
- The config changes by file and layer.
- Staged rollout notes for HSTS and any enforcing policy.
