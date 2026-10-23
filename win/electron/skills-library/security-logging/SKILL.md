---
name: security-logging
description: Defines the security events an application should log (auth, access control, admin actions, input rejections), the fields each needs, redaction rules and tamper resistance, and the alerts that use them. Use when the user asks for audit logging, wants to detect brute force or abuse, or needs to log security events safely.
---

# Security logging

## Goal

Be able to answer who did what, to what, when, from where and with what result, for the events that matter.

A good setup records enough to investigate an incident, and nothing that creates a new breach if the logs leak.

## When to use

- The app has no audit trail of logins or admin actions.
- An incident could not be investigated for lack of logs.
- A compliance request asks for event logging in plain terms.
- For the log pipeline and search, use `use_skill` with `log-aggregation`.

## Steps

1. Find existing logging with `search_files` for `logger`, `audit`, `log.` and framework middleware, and read how events are formed with `read_file`.
2. List events to record: login success and failure, logout, password change and reset, multi-factor changes, permission or role changes, access denied, admin actions, data export, API key creation, and rejected input that looks hostile.
3. Define a fixed schema per event: UTC timestamp, event type, actor id, actor address, target object, action, result, request id, and reason for failure.
4. Log identifiers, not secrets. Never write passwords, tokens, session ids, full card numbers or whole request bodies. Add redaction at the logger so a mistake cannot leak.
5. Guard against log injection: strip or encode newlines and control characters in user supplied values, or use structured JSON where the field is a value.
6. Add the logging at decision points with `edit_file`, such as the authorisation middleware and login handler, so no path skips it.
7. Send security logs to a place the application cannot alter: a separate store with append-only or restricted write access, and restricted read access too.
8. Set retention to match investigation needs and privacy rules for personal data. Ask the user for the required period.
9. Define detections using the events: many failures from one address or against one account, a login from a new country followed by an export, a role change outside business hours. Take thresholds from the user's normal data.
10. Make sure clocks are synchronised across hosts so event order is trustworthy.
11. Test by performing each event and finding it in the log with the right fields.
12. Document the event catalogue for responders.

## Gotchas

- Logging the failed username field often captures a password typed into it. Redact or hash it.
- Logs that anyone with app access can edit are useless as evidence after a compromise.
- Too much logging buries the signal and costs money. Log security decisions, not every request body.
- Only logging failures hides the account takeover that succeeds. Log successes and their context.
- Client addresses behind a proxy are the proxy's unless the trusted forwarded header is configured.
- Personal data in logs has its own retention duty. Use ids that can be resolved elsewhere.

## Output

- An event catalogue table: event, fields, where logged, alert.
- Code changes and the redaction rules.
- Test evidence and open questions on retention.
