---
name: auth-flow-review
description: Reviews login, session, token, password reset and permission flows in code for concrete weaknesses, ranked by exploitability, with fixes. Use when the user asks to review an auth flow, whether login is secure, or to check JWT and session handling.
---

# Auth flow review

## Goal

Find the places where an attacker could log in as someone else, stay logged in too long or reach data they should not. A good review traces real code paths, ranks findings by how easily they can be exploited and avoids generic advice.

## When to use

- The user asks for a review of authentication, sessions or tokens.
- A new login, signup, password reset or OAuth flow is about to ship.
- For a broader security pass over a change, use `use_skill` with `security-review`.
- For abuse limits on login attempts, use `use_skill` with `rate-limiting`.

## Steps

1. Map the flow. Use `search_files` for login, signup, logout, reset, token, session, cookie and middleware names, then `read_file` the auth module. Draw the sequence in notes: credentials in, session or token out, how each later request is checked.
2. Passwords: check hashing uses a slow password hash from a maintained library with per-user salt, and that nothing logs or returns the password. Check current recommended parameters with `read_url` instead of recalling numbers.
3. Sessions and cookies: check `HttpOnly`, `Secure`, `SameSite`, expiry, rotation of the session id after login, and invalidation on logout and password change.
4. Tokens: if JWTs are used, check the algorithm is pinned and not taken from the header, signature is verified, expiry and audience are checked, secrets are strong and not in code, and refresh tokens can be revoked.
5. Reset and verification: tokens are random, single use, short lived and stored hashed. Responses do not reveal whether an account exists.
6. Authorization: every route that touches user data checks both who the caller is and whether they may touch that object. Look for checks done only in the UI or only on some routes.
7. Brute force and enumeration: login, reset and signup are rate limited and give uniform responses and timing where reasonable.
8. Third-party login: the OAuth state parameter is checked, redirect URIs are exact matches and tokens from the provider are verified, not trusted blindly.
9. Verify suspected issues by tracing the path or running a test with `run_command`. Drop what you cannot substantiate or mark it as a question.

## Gotchas

- Authentication proves who you are, authorization decides what you may do. A route with a login check and no ownership check is the most common serious hole.
- Storing a token in local storage exposes it to any script injected into the page. A cookie with `HttpOnly` is safer against that but needs CSRF defences.
- A JWT cannot be revoked before expiry unless the server keeps state. Long-lived JWTs with no revocation survive a stolen laptop.
- Comparing secrets with plain equality leaks timing. Use the library's constant-time comparison.
- Different messages for "no such user" and "wrong password" let attackers list valid accounts.
- Trusting a role or user id sent by the client (header, body, token claim unsigned) is a bypass. Take identity from the verified session only.

## Output

- Findings ranked Critical, Should fix and Consider, each with file and line, attack scenario and fix.
- The auth flow diagram in a few lines of text.
- What you did not review, such as infrastructure, third-party services and client code.
