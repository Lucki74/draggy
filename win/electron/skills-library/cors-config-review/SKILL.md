---
name: cors-config-review
description: Reviews CORS configuration for reflected origins, wildcard with credentials, loose regexes, over-broad methods and headers, and explains browser CORS errors without weakening the policy. Use when the user asks to check CORS settings, hits a CORS error, or wonders whether allowing all origins is safe.
---

# CORS config review

## Goal

Let the intended web front ends call the API and nobody else's pages.

A good fix names exact origins, and the user understands that CORS is a browser rule, not authentication.

## When to use

- The API sets `Access-Control-Allow-Origin`.
- The browser shows a CORS error during development or after a deploy.
- A review sees `*` or origin reflection.
- For other response headers, use `use_skill` with `security-headers`.

## Steps

1. Find CORS code and proxy config with `search_files` for `Access-Control`, `cors(`, `CORS_`, `allowedOrigins` and `add_header` in nginx files. Read each with `read_file`.
2. List which origins should be allowed: the production site, staging, local development. Ask the user if unclear.
3. Check how the allowed origin is chosen. Flag: `*`, an origin copied from the request without checking a list, regex without anchors, and `endsWith` or `includes` checks.
4. Check credentials. `Access-Control-Allow-Credentials: true` must pair with an exact origin, never a wildcard. Confirm whether cookies are even used.
5. Check `null` origin acceptance, which sandboxed frames and local files can send.
6. Check allowed methods and headers: only those the front end needs. Check `Access-Control-Max-Age` is reasonable.
7. Check the response adds `Vary: Origin` when the value changes per request so caches do not serve one origin's answer to another.
8. Check preflight handling: `OPTIONS` returns the headers without requiring authentication and without running business logic.
9. Check what an allowed origin can actually read, and whether sensitive endpoints rely on network location or cookies alone.
10. To reproduce an error, open the page with `browser_navigate` and read `browser_console`, or send a request with `run_command` and `curl -i -H "Origin: ..."` to see the headers.
11. Edit the config with `edit_file` to a fixed allow list, with separate lists per environment.
12. Re-test with an allowed origin, a disallowed origin and a preflight.

## Gotchas

- CORS does not stop requests reaching the server. It only controls whether the browser lets a page read the response, so it is not a replacement for authorisation.
- Reflecting any `Origin` with credentials allowed lets any site read a logged-in user's data.
- A regex like `example.com` unanchored also matches `example.com.evil.net`.
- A browser error often hides a server failure: a 500 or a redirect without CORS headers reports as a CORS error.
- Developers add `*` to fix an error and ship it. Keep local origins in development config only.
- Subdomain wildcards trust every subdomain, including forgotten ones that can be taken over.

## Output

- The current policy in plain words and the issues found, ranked.
- The corrected configuration.
- Test requests used and their headers.
