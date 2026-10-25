---
name: rate-limiting
description: Chooses limits, identifying keys, algorithm and storage for API rate limiting, and implements it with correct 429 responses and headers. Use when the user asks to add rate limiting, protect an API from abuse, or throttle login attempts.
---

# Rate limiting

## Goal

Protect the service and its users from bursts and abuse without blocking normal use. A good result has limits chosen from real traffic, a key that identifies the caller correctly, shared storage across instances and responses that tell clients when to retry.

## When to use

- The user wants to limit request rates globally, per user, per key or per route.
- Login, signup, search or expensive endpoints are being abused.
- For the login flow as a whole, use `use_skill` with `auth-flow-review`.
- For making retried writes safe, use `use_skill` with `idempotency-keys`.

## Steps

1. Find where requests enter. Use `search_files` for existing middleware, gateway or proxy configuration with `read_file`. A limit at the edge (gateway, CDN) may already exist and can be extended instead of rebuilt.
2. Decide what is being protected: capacity, cost (expensive queries, paid third-party calls), or abuse (guessing passwords, scraping). The goal sets the limit and the key.
3. Choose the key. Authenticated user or API key where available, IP address for anonymous routes, and a combination for login (account plus IP). If a proxy or load balancer sits in front, read the client address from the trusted forwarded header only, using the proxy count the deployment really has.
4. Choose the algorithm: fixed window is simple but allows double bursts at window edges, sliding window is smoother, token bucket allows controlled bursts. Pick one and say why.
5. Set numbers from evidence. Look at real traffic or logs with `run_command` if available, and ask with `ask_user` about expected legitimate use. Start generous, measure, then tighten.
6. Store counters in shared storage (Redis or the gateway's store) if there is more than one instance. Per-process memory counters multiply the limit by the number of instances.
7. Respond with status 429, a `Retry-After` header and the project's error shape. Include limit, remaining and reset headers if the project documents them.
8. Add tests for under, at and over the limit, for reset after the window and for two different keys not sharing a counter. Run them with `run_command`.
9. Decide the failure mode: if the limiter store is down, fail open (allow) for normal routes and fail closed for sensitive ones, and write it down.

## Gotchas

- Behind a proxy, the connection address is the proxy's, so one limit covers all users. Behind no proxy, trusting the forwarded header lets anyone spoof their address.
- Limiting by IP alone penalizes users behind shared networks and does little against a distributed attack.
- Counters held in memory reset on every deploy and are not shared across instances.
- Retrying clients with no backoff turn a limit into a thundering herd right at reset. Document jitter and `Retry-After`.
- A limit on the route but not on the equivalent alternative (GraphQL, batch or v1 endpoint) is bypassed through the other path.
- Rate limiting does not replace authentication or quotas. A paid plan quota is a separate, persistent counter.

## Output

- The limit table: route or group, key, algorithm, limit, window.
- The implementation changes and tests run.
- Open questions: traffic data you lacked and the failure mode chosen.
