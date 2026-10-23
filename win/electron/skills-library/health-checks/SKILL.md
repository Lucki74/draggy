---
name: health-checks
description: Designs and implements liveness, readiness and startup health endpoints with the right depth of checks, timeouts and caching, so orchestrators and load balancers restart or route correctly. Use when the user asks to add a health check, fix flapping or killed instances, or decide what readiness should test.
---

# Health check endpoints

## Goal

Give each consumer a signal that means what it needs: should I restart this, should I send traffic, has it finished booting.

A good health design never causes an outage by itself.

## When to use

- A service has no health endpoint or only a static ok.
- Instances restart in loops or get removed from rotation randomly.
- Deploys send traffic to instances that are not ready.
- For alerts that use these checks, use `use_skill` with `monitoring-alerts`.

## Steps

1. Find the framework and any existing route with `search_files` for `/health`, `/healthz`, `/ready` and read the server entry with `read_file`.
2. Find how the platform checks: Dockerfile `HEALTHCHECK`, compose, Kubernetes probes, load balancer settings. Read those files so the endpoint matches the paths and timings.
3. Create a liveness route that checks only the process: event loop responsive, returns 200 fast, touches no dependency.
4. Create a readiness route that checks what this instance needs to serve: database ping, cache, required config loaded, migrations done. Keep each check on a short timeout.
5. Add a startup signal for slow boots: readiness stays false until warm up finishes, instead of lengthening liveness delays.
6. Return a small JSON body listing each check with status and duration. Return 503 when not ready.
7. Do not expose versions, hostnames or internal addresses on a public route. Put detailed output behind internal access.
8. Cache dependency results for a few seconds so many probers do not hammer the database.
9. Test locally with `run_command` and `curl`: healthy, then stop the database and confirm readiness fails while liveness passes.
10. Align timeouts: probe timeout above the slowest healthy check, period and failure count tuned so one slow response does not remove the instance.
11. Handle graceful shutdown: on SIGTERM turn readiness false, finish in-flight requests, then exit.
12. Add the probe configuration to the manifest with `edit_file`.

## Gotchas

- A liveness check that calls the database restarts every instance during a database outage and makes it worse.
- A readiness check that depends on a flaky optional service removes the whole fleet from rotation. Check only hard dependencies.
- Probes hitting an authenticated route return 401 and mark everything unhealthy. Make health routes open and cheap.
- The probe timeout default is often one second, shorter than a cold database ping.
- Without a shutdown hook, deploys drop requests because traffic still arrives after SIGTERM.
- A health route behind redirects to HTTPS can fail when the prober uses plain HTTP.

## Output

- The endpoints added with paths and what each checks.
- Probe settings and the reasoning for timings.
- The local failure test result.
