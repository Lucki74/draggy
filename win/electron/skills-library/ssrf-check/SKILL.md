---
name: ssrf-check
description: Finds server-side features that fetch a URL influenced by users (webhooks, link previews, image import, proxies, PDF renderers) and hardens them with allow lists, resolved-address checks and network egress controls. Use when the user asks to check for SSRF, accepts URLs from users, or wants webhooks that cannot reach internal systems.
---

# SSRF check

## Goal

Make sure a user cannot use the server to reach internal services, cloud metadata or local files.

A good defence validates the destination after name resolution, and the network itself blocks what the code misses.

## When to use

- The app has webhooks, URL import, link unfurling or an image proxy.
- It renders user-given URLs to PDF or screenshots.
- It runs in a cloud environment with a metadata service.
- For general input checks, use `use_skill` with `input-validation-audit`.

## Steps

1. Find outbound request code with `search_files` for `fetch(`, `axios`, `requests.get`, `http.Get`, `urlopen`, `curl`, `webhook`, `url` parameters and headless browser use. Read each with `read_file`.
2. For each, trace whether any part of the URL (host, path, scheme, redirect) comes from a user, stored data or a third party.
3. Prefer an allow list of known hosts. If arbitrary URLs are a product need (webhooks), use the checks below.
4. Restrict schemes to `https` (and `http` only if required). Reject `file:`, `gopher:`, `ftp:` and others.
5. Parse the URL with a real parser, then resolve the hostname yourself and check every resulting address against blocked ranges: loopback, private, link-local (including the cloud metadata address), multicast, and the IPv6 equivalents.
6. Connect to the checked address so the name cannot resolve differently on the second lookup (DNS rebinding). Pin the resolved address for the request.
7. Disable automatic redirects, or follow them manually and apply the same checks at each hop. Limit hop count.
8. Set short timeouts, response size limits and a content type check. Do not return the raw response body or detailed errors to the user.
9. On cloud hosts, require the hardened metadata version where available (check provider docs with `read_url`) and give the workload a minimal role.
10. Add network egress rules so the app's subnet can reach only what it needs. Treat this as the backstop.
11. Test with local address forms: `127.0.0.1`, `localhost`, decimal and hex forms, `[::1]`, a name pointing to a private address, and a redirect to an internal URL.
12. Edit the code with `edit_file` and report each fetch site as safe, fixed or open.

## Gotchas

- Checking the hostname string is not enough. Many alternate spellings of an address resolve to the same internal host.
- Validating the URL and then fetching it lets DNS return a different address on the second lookup.
- A redirect from an allowed host to an internal one defeats a check done only on the first URL.
- Headless browsers and PDF renderers fetch subresources, so a user HTML page can make them request internal URLs.
- Blind SSRF returns no body but still reaches internal services. Absence of output is not safety.
- The cloud metadata endpoint holds credentials. It is the usual target, so block it explicitly.

## Output

- A table of fetch sites: feature, user control over URL, defences, status.
- The shared safe-fetch helper or changes made.
- Test results for each bypass form tried.
