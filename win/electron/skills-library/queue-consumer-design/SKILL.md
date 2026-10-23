---
name: queue-consumer-design
description: Designs a message queue consumer with correct acknowledgement, retries, backoff, dead-letter handling, concurrency and ordering assumptions. Use when the user asks to design a queue consumer, messages are processed twice, or they need a plan for failed messages.
---

# Queue consumer design

## Goal

A consumer that processes each message effectively once, survives crashes and bad messages, and shows when something is stuck. A good result states the delivery guarantee of the broker, what the consumer does to cope with it and what happens to messages that never succeed.

## When to use

- A new consumer for a broker or job queue is being written.
- Messages are lost, duplicated, stuck or processed in the wrong order.
- For jobs the app enqueues for itself, use `use_skill` with `background-jobs`.
- For the receiving side of third-party HTTP events, use `use_skill` with `webhook-handler`.

## Steps

1. Identify the broker and its guarantees. Read the code and config with `read_file` and `search_files`, and check the broker's documentation with `read_url`: delivery semantics (at most once or at least once), visibility timeout or ack deadline, ordering scope, redelivery and dead-letter features.
2. Define the message contract: type, version, an id that is unique per logical event, and the minimum data needed. Treat the schema as a public API and tolerate unknown fields.
3. Choose acknowledgement timing. Acknowledge only after the work and its side effects are durably done. If the work can exceed the visibility timeout, extend it periodically or split the work.
4. Make processing idempotent. With at-least-once delivery, duplicates are normal. Record processed ids with a unique constraint, or make the effect naturally repeatable. Use `use_skill` with `idempotency-keys` for the pattern.
5. Classify failures. Transient (timeouts, 503, lock conflicts) get retried with exponential backoff and jitter. Permanent (invalid payload, missing required record) go straight to a dead-letter queue with the error attached.
6. Cap retries and poison messages. After the maximum attempts, move the message to the dead-letter queue, and alert on its depth. Provide a way to inspect and replay from it after a fix.
7. Set concurrency to match downstream capacity. Prefetch only what you can finish within the timeout, and use backpressure when a dependency is slow.
8. Handle ordering only where needed. If order matters per entity, partition or group by that key and process each partition serially, accepting the throughput cost. Otherwise design for any order.
9. Plan shutdown and deploys: stop taking new messages, finish or release in-flight ones and exit, so rolling deploys do not drop work.
10. Test with `run_command`: duplicate delivery, crash after work before ack, a poison message, and a slow dependency.

## Gotchas

- Acknowledging on receipt turns every crash into silent message loss. Acknowledge after the work is done.
- Retrying a permanent failure forever blocks the queue and burns resources. Park it after a few attempts.
- Assuming strict ordering from a broker that only orders within a partition or group leads to rare, hard to reproduce bugs.
- A visibility timeout shorter than the work causes the broker to hand the same message to a second consumer while the first still runs.
- Huge messages stress the broker. Put the data in storage and send a reference.
- A consumer with no metrics fails silently. Track queue depth, age of the oldest message, processing time and failure rate.

## Output

- A design summary: guarantees, ack point, idempotency method, retry and dead-letter policy, concurrency.
- The consumer code changes and tests run.
- Operational notes: alerts to set and the replay procedure.
