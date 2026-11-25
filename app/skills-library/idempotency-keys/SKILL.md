---
name: idempotency-keys
description: Adds idempotency to write endpoints so a retried or double-submitted request produces one effect, using client keys, atomic storage and response replay. Use when the user asks to make an endpoint idempotent, prevent duplicate charges on retry, or handle double submits on the server.
---

# Idempotency keys

## Goal

A client that repeats a write because of a timeout or a double click gets the original result, and the side effect happens once. A good result reserves the key before doing work, ties it to the request content and survives crashes mid-request.

## When to use

- A POST creates orders, payments, messages or other effects that must not duplicate.
- Clients or queues retry requests, or users double-click submit.
- For consumers of message queues, use `use_skill` with `queue-consumer-design`.
- For slow work that moves off the request path, use `use_skill` with `background-jobs`.

## Steps

1. Identify which operations need it. Reads and naturally idempotent writes (PUT to a fixed id, DELETE) usually do not. Creation and anything with external side effects (payments, emails) do. Read the handlers with `read_file`.
2. Define the contract: the client sends a unique `Idempotency-Key` header, typically a random UUID per logical operation. Check whether an upstream provider has a convention to copy using `read_url`.
3. Design the storage: a table or store with key, caller scope, request fingerprint (hash of method, path and body), status (in progress, completed), saved response (status and body) and timestamps. Make the key unique per caller.
4. Reserve first. At the start of the request, insert the key with status in progress using a unique constraint. If the insert conflicts, another request owns it.
5. Handle the three cases on conflict: completed with the same fingerprint, return the saved response; in progress, return 409 or wait briefly; same key with a different fingerprint, return an error because the client reused a key.
6. Do the work, then save the response and mark completed. Where the work is a database write, put the key update in the same transaction as the effect.
7. For external calls (a payment provider), pass your key through to the provider if it supports one, so retries on your side stay safe as well.
8. Expire old keys after a window long enough to cover realistic retries, and set that window with the user.
9. Test with `run_command`: same key twice, concurrent same key, same key with a different body, crash between work and save.

## Gotchas

- Recording the key after the side effect leaves a gap: a crash in between means the retry repeats the effect. Reserve before.
- Accepting the same key with a different body returns the wrong cached response. Compare fingerprints.
- Keys must be scoped by caller, or one user can replay or read another's saved response.
- Saving error responses forever means a transient 500 is replayed even when the retry would succeed. Replay only final outcomes, and release the key on retryable failures.
- Server-generated keys do not help, since a retry needs the same key. The client must create it before the first attempt.
- A unique constraint is the safe arbiter. A read-then-insert check is racy under concurrent requests.

## Output

- The contract: header name, scope, expiry and conflict behaviour.
- The storage schema and the handler changes.
- Tests run and the failure windows still open.
