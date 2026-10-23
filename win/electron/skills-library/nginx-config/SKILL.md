---
name: nginx-config
description: Writes, reviews and debugs nginx configuration for reverse proxying, TLS, redirects, websockets, caching and static files, validating with nginx -t before reload. Use when the user asks to set up nginx, add HTTPS or redirects, or fix 502, 504 and 413 errors.
---

# Nginx config

## Goal

Produce a minimal config that does what the user needs and can be checked before it touches live traffic.

A good result states what each block does so the next person can change it.

## When to use

- A reverse proxy in front of an app is needed.
- Requests fail with 502, 504, 413 or redirect loops.
- TLS, HTTP to HTTPS redirect or websockets need setting up.
- For host level SSH access, use `use_skill` with `ssh-hardening-setup`.

## Steps

1. Read the current config. Use `list_directory` on the nginx config folder and `read_file` on `nginx.conf` and included site files.
2. Ask or detect the upstream: host, port, protocol and whether the app expects forwarded headers.
3. Write a `server` block with `server_name`, `listen`, and `location` blocks. Use `create_file` for a new site file rather than growing `nginx.conf`.
4. Proxy with `proxy_pass` and set `Host`, `X-Real-IP`, `X-Forwarded-For` and `X-Forwarded-Proto`. Check the trailing slash behaviour of `proxy_pass` before writing the path.
5. For websockets add the `Upgrade` and `Connection` headers and `proxy_http_version 1.1`, and a read timeout above idle gaps.
6. For TLS point to certificate files, redirect port 80 to HTTPS, and take the cipher and protocol settings from a current recommendation. Fetch it with `read_url` from the Mozilla SSL config generator page rather than recalling.
7. Add `client_max_body_size` for uploads and sensible timeouts. Add gzip and cache headers for static files with `location` blocks.
8. Set security headers and hide the server version with `server_tokens off`.
9. Validate with `nginx -t` through `run_command` (or the docker equivalent) before any reload.
10. Reload with `nginx -s reload`, not restart, then test with `curl -I` for status, redirects and headers.
11. Debug errors in the error log with `read_file` or `run_command` tail, and match the message to the cause.
12. Save the final config and describe each block.

## Gotchas

- A trailing slash on `proxy_pass` changes how the request path is rewritten, and gives surprising 404s.
- `if` inside `location` is unreliable. Prefer `map`, `try_files` or separate locations.
- 502 with the upstream running is often the upstream listening on 127.0.0.1 inside another container, or an SELinux rule.
- The default body limit is small, so uploads fail with 413 before reaching the app.
- Nginx resolves upstream hostnames once at start. When the container IP changes, it keeps the old one unless a resolver and variable are used.
- Setting `X-Forwarded-For` from client supplied input lets users spoof their address.

## Output

- The config file path and the complete block that was added, with short comments.
- The `nginx -t` result.
- The curl checks run and what they showed.
