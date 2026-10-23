---
name: dockerfile
description: Containerises applications with small, secure, cache-friendly Dockerfiles (multi-stage builds, pinned bases, non-root users, health checks) and a compose file for local development when useful. Use when the user wants to dockerise a project, write or fix a Dockerfile, or speed up or slim down image builds.
---

# Dockerfile

## Goal

Produce a Dockerfile that builds fast on repeat, ships a small image and runs without root. A good result is tested when Docker is available, and tells the user which environment variables it needs.

## When to use

- The user wants to dockerise a project.
- An existing Dockerfile is slow, large, insecure or broken.
- The user needs a docker-compose setup with a database or cache for local work.

## Steps

1. Learn the app. Read the manifest and scripts with `read_file` for: language and runtime version, how dependencies are installed, the build command, the start command, the port, required environment variables, and any system packages needed (use `search_files` for things like sharp, psycopg, libvips). Check for an existing Dockerfile or .dockerignore.
2. Build a good image:
   1. **Pin the base:** an official image with a specific version, slim or alpine only if compatible (musl can break native modules). Examples: `node:22-bookworm-slim`, `python:3.12-slim`, `golang:1.23` for build and `gcr.io/distroless/static` or `debian:bookworm-slim` for run.
   2. **Multi-stage:** a build stage with compilers and dev dependencies, a runtime stage with only what runs.
   3. **Cache layers:** copy the manifest and lock file first, install dependencies, then copy the source.
   4. **Reproducible installs:** `npm ci`, `pip install --no-cache-dir -r requirements.txt`, `go mod download`.
   5. **Non-root:** create or use an unprivileged user and `USER` it in the final stage.
   6. **Config via environment:** never bake secrets into the image or build arguments, and document the required variables.
   7. **Metadata:** `EXPOSE` the port, add a `HEALTHCHECK` when the app has a health endpoint, and use exec-form `CMD ["node", "server.js"]` so signals reach the process.
   8. **.dockerignore:** exclude .git, node_modules, build output, env files, logs, and tests if not needed.
3. For local development, when the app needs services (database, cache), write a compose.yaml with named volumes, health-check-based `depends_on`, and env values from an .env file that is git-ignored. Create the files with `create_file`.
4. Verify. If Docker is installed, build and run with `run_command` (`docker build -t app .`, `docker run --rm -p 3000:3000 app`) and check that it starts. Report the image size (`docker images app`). If Docker is not available, say the files are untested.

## Gotchas

- Alpine uses musl, which can break native modules. Pick a slim Debian base when a package ships glibc binaries.
- Copying the whole source before installing dependencies throws away the layer cache on every code change.
- Shell-form `CMD` runs the app under `sh`, so stop signals do not reach it and shutdown hangs. Use exec form.
- A missing .dockerignore sends .git, node_modules and env files into the build context, and possibly into the image.
- Secrets passed as build arguments stay readable in the image history.

## Output

The files created, the build and run commands, required environment variables, and the choices made (base image, stages).
