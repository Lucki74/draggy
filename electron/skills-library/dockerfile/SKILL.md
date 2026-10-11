---
name: dockerfile
description: Containerises applications with small, secure, cache-friendly Dockerfiles (multi-stage builds, pinned bases, non-root users, health checks) and a docker-compose file for local development when useful. Use when the user wants to dockerise a project, fix a Dockerfile, or speed up or slim down image builds.
---

# Dockerfile

## Learn the app

Read the manifest and scripts for: language and runtime version, how dependencies are installed, the build command, the start command, the port, required environment variables, and any system packages needed (search_files for things like sharp, psycopg, libvips). Check for an existing Dockerfile or .dockerignore.

## Build a good image

1. **Pin the base:** official image with a specific version, preferably slim or alpine only if compatible (musl can break native modules): `node:22-bookworm-slim`, `python:3.12-slim`, `golang:1.23` for build and `gcr.io/distroless/static` or `debian:bookworm-slim` for run.
2. **Multi-stage:** a build stage with compilers and dev dependencies, a runtime stage with only what runs.
3. **Cache layers:** copy the manifest and lock file first, install dependencies, then copy the source.
4. **Reproducible installs:** `npm ci`, `pip install --no-cache-dir -r requirements.txt`, `go mod download`.
5. **Non-root:** create or use an unprivileged user and `USER` it in the final stage.
6. **Config via environment**, never secrets baked into the image or build arguments; document required variables.
7. **Metadata:** `EXPOSE` the port, a `HEALTHCHECK` when the app has a health endpoint, exec-form `CMD ["node", "server.js"]` so signals reach the process.
8. **.dockerignore:** exclude .git, node_modules, build output, env files, logs, tests if not needed.

## Local development

When the app needs services (database, cache), write a compose.yaml with named volumes, health-check-based depends_on, and env values from an .env file that is git-ignored.

## Verify

If Docker is installed, build and run with run_command (`docker build -t app .`, `docker run --rm -p 3000:3000 app`) and check it starts. Report the image size (`docker images app`). If Docker is not available, say that the files are untested.

## Report

The files created, the build and run commands, required environment variables, and choices made (base image, stages).
