---
name: password-storage-review
description: Reviews password hashing, salting, policy and comparison code, recommends a current password hashing algorithm after checking live guidance, and designs a migration that upgrades hashes at login. Use when the user asks how to store passwords, wants a hashing review, or has legacy MD5 or SHA hashes.
---

# Password storage review

## Goal

Make a stolen database as useless as possible for recovering passwords.

A good result uses a slow, salted, purpose-built hash with tuned cost and a path to upgrade old hashes without forcing resets.

## When to use

- The app has its own users table with passwords.
- Old hashes use fast algorithms or no salt.
- A breach drill or audit asks for proof of storage safety.
- For sessions and tokens after login, use `use_skill` with `auth-session-review`.

## Steps

1. Find the code with `search_files` for `password`, `hash`, `bcrypt`, `argon`, `scrypt`, `pbkdf2`, `md5`, `sha1`, `sha256`, `crypt`. Read the user model and login code with `read_file`.
2. Identify the current algorithm, the cost settings and where the salt comes from. Look at the stored hash format in the schema or a seed file; the prefix often shows the scheme.
3. Check live guidance with `read_url` (the OWASP Password Storage Cheat Sheet) for the currently recommended algorithm and parameters, since recommendations change. Do not recall parameter values from memory.
4. Reject plain text, reversible encryption, unsalted hashes and fast general hashes (MD5, SHA-1, SHA-256 alone) for passwords.
5. Use a maintained library for argon2id, scrypt or bcrypt. Do not write the primitive. Let the library create the salt and store it inside the output string.
6. Tune cost on production-like hardware so that one hash takes a noticeable but acceptable time at login, and record the setting.
7. Check the comparison uses the library's verify function, which compares in constant time.
8. Design the upgrade: at successful login, if the stored hash uses the old scheme or low cost, verify with the old method, rehash with the new and save. For hashes that never log in, wrap the old hash inside the new scheme in a batch job.
9. Check length limits. Allow long passphrases and all characters. Some schemes truncate input (bcrypt has a byte limit), so pre-hashing rules need care.
10. Check password policy against current guidance: length over complexity rules, a check against known breached passwords, no forced periodic rotation.
11. Check logs, errors and analytics never receive the plain password, and that reset tokens are hashed at rest.
12. Add tests for verify, upgrade on login and wrong password.

## Gotchas

- Adding a salt to SHA-256 does not make it a password hash. The speed is the problem.
- Cost settings copied from an old tutorial are too low for current hardware. Check the live guidance.
- A site-wide secret (pepper) helps only if it lives outside the database, for example in a secrets manager.
- Silent truncation at a byte limit means two long different passwords can match. Know your library's limit.
- Forcing everyone to reset at once causes support load and phishing opportunities. Upgrade at login instead.
- Different error text or timing for unknown users leaks which accounts exist.

## Output

- The current scheme, its weaknesses, and the recommended replacement with the source checked and date.
- The migration plan in steps.
- Code changes and tests.
