---
name: docker-compose-setup
description: Writes or repairs a docker-compose file for running an app with its database, cache and workers locally, with health-gated startup, named volumes and sane networking. Use when the user asks to set up Docker Compose, add a service to a compose file, or fix containers that cannot talk to each other.
---

# Docker Compose setup

## Goal

Give the project one command, `docker compose up`, that starts every service the app needs in a working order.

A good result starts cleanly from a fresh checkout, keeps data across restarts, and does not expose internal ports to the network by accident.

## When to use

- The user wants a local dev stack with a database, cache, queue or mail catcher.
- An existing compose file starts services in the wrong order or loses data.
- Services fail with connection refused or name resolution errors.
- For the application image itself, use `use_skill` with `dockerfile` first.

## Steps

1. List what the app needs. Use `search_files` for connection strings, `process.env` or `os.environ` reads, and `.env.example`, and read the README with `read_file`.
2. Check for an existing `compose.yaml` or `docker-compose.yml` with `list_directory`. Edit it instead of adding a second file.
3. Run `run_command` with `docker compose version` to confirm Compose v2 is installed. Check the live docs with `read_url` before using any newer key you are unsure of.
4. Define one service per process. Pin image tags to a specific minor version instead of `latest`, and look the current tags up on the registry page with `read_url` rather than guessing.
5. Give every stateful service a named volume, and mount it at the data directory the image documents, not at a guessed path.
6. Add a `healthcheck` to each dependency (for example `pg_isready` for Postgres) and use `depends_on` with `condition: service_healthy` in the app service.
7. Let services reach each other by service name on the default network. Replace `localhost` in the app's connection strings with the service name.
8. Publish ports only for what the developer needs from the host. Bind them as `127.0.0.1:5432:5432` so the database is not open to the LAN.
9. Move secrets and tunables to an `env_file`, add the file to `.gitignore`, and commit an `.env.example` with placeholder values.
10. Run `docker compose config` with `run_command` to validate the merged file, then `docker compose up -d` and `docker compose ps` to see health states.
11. Check logs with `docker compose logs --tail 50 <service>` for each service that is not healthy, and fix the cause rather than adding a restart policy.
12. Document the commands (up, down, reset data with `down -v`) in the README with `edit_file`.

## Gotchas

- `depends_on` without a health condition only waits for the container to start, not for the database to accept connections.
- Inside a container `localhost` is the container itself. A connection string copied from a host-run setup breaks.
- A bind mount over `node_modules` or a virtualenv hides what the image installed and causes missing-module errors.
- Running `docker compose down -v` deletes named volumes. Never suggest it without saying the data is lost.
- Init scripts in `/docker-entrypoint-initdb.d` run only when the data directory is empty, so edits seem to be ignored on an existing volume.
- A published port bound to `0.0.0.0` can be reached from other machines, and Docker bypasses some host firewall rules.

## Output

- The created or edited compose file path, with the services it defines.
- The exact commands to start, stop and reset the stack.
- Which ports are exposed on the host and why.
- Anything not verified because Docker was unavailable.
