---
name: webhook-handler
description: Builds an endpoint that receives webhooks, verifying the signature on the raw body, acknowledging quickly, deduplicating by event id and processing asynchronously. Use when the user asks to handle incoming webhooks, verify a webhook signature, or says an event was delivered twice.
---

# Webhook handler

## Goal

Accept events from an external service without trusting forged requests, losing events or processing them twice. A good result verifies authenticity, answers within the sender's time limit and handles out-of-order and repeated deliveries.

## When to use

- The user integrates a provider that posts events to their server.
- Events arrive twice, late, out of order or not at all.
- For the processing queue behind the endpoint, use `use_skill` with `queue-consumer-design`.
- For writing the dedupe record safely, use `use_skill` with `idempotency-keys`.

## Steps

1. Read the provider's webhook documentation with `read_url`: signature header name, signing scheme, timestamp tolerance, event types, retry policy and expected response. Never rely on memory for these details.
2. Create the route. Make sure the framework gives you the raw request body, because the signature covers the exact bytes. Configure raw body capture for this route only.
3. Verify before anything else: compute the expected signature with the shared secret from configuration, compare with a constant-time function and check the timestamp is within the allowed window to block replays. Reject failures with 400 or 401 and no detail.
4. Parse the body only after verification. Validate that the event has the fields you use.
5. Deduplicate. Store the event id with a unique constraint when you first see it. If the insert conflicts, return 200 without processing again.
6. Acknowledge fast. Record the event, enqueue the work and return 2xx right away. Do the heavy processing in a job, since senders time out and retry after a few seconds.
7. Handle ordering. Events can arrive out of sequence. Use the event time or a version from the payload, or fetch the current object state from the provider API instead of trusting the event's snapshot.
8. Make processing idempotent by itself, so a replay from the dashboard or a retry is harmless.
9. Test with a captured sample payload and a valid signature, a tampered body, an old timestamp and a duplicate. Run them with `run_command`. Use the provider's test tooling for real deliveries if available.

## Gotchas

- Verifying the signature over a re-serialized JSON object fails or, worse, passes for modified content. Use the raw bytes.
- Doing the work before responding makes the sender time out and retry, which creates duplicates of slow work.
- Treating the webhook as the source of truth for state breaks on late or reordered events. Fetch current state when order matters.
- Putting the secret in code or logs, or logging the full signed payload with personal data, creates a leak. Load secrets from configuration.
- Returning an error for events you do not care about makes the sender retry them and eventually disable the endpoint. Return 2xx for unknown types and log them.
- An open endpoint with no verification lets anyone trigger business actions. Restricting by IP is a supplement, not a substitute.

## Output

- The route, verification and dedupe code, listed by file.
- The event types handled and their processing path.
- Tests run, and what depends on the real provider that you could not test.
