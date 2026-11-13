---
name: container-size-diet
description: Analyses a container image and Dockerfile to cut size and build time: layer inspection, multi-stage builds, smaller base images, ignore files and cache ordering, while keeping the image working. Use when the user asks why an image is huge, wants a faster Docker build, or wants a slimmer production image.
---

# Container size diet

## Goal

Make the image smaller and the build faster without breaking runtime behaviour.

A good result shows before and after sizes from the same measurement.

## When to use

- An image is hundreds of megabytes or gigabytes for a small app.
- Rebuilds reinstall dependencies on every code change.
- Pulls are slow in CI or in deploys.
- To write a Dockerfile from scratch, use `use_skill` with `dockerfile`.

## Steps

1. Read the Dockerfile and `.dockerignore` with `read_file`. List the base image, copy steps and installs.
2. Measure first. Run `docker images` and `docker history --no-trunc <image>` with `run_command` to see size per layer. Note the total as the baseline.
3. If the `dive` tool is installed, use it to find wasted files. Otherwise list the largest paths inside the image with `docker run --rm <image> du -ah / | sort -rh | head`.
4. Add or fix `.dockerignore`: `.git`, `node_modules`, build output, test data, local env files, logs. Check the context size printed at build start.
5. Use a multi-stage build: build tools in the first stage, only the runtime artifacts copied to the final stage.
6. Choose a smaller runtime base only when compatible. Slim variants are usually safe. Alpine uses musl and can break native modules. Distroless has no shell. Check current tags with `read_url`.
7. Order layers by change frequency: copy dependency manifests, install, then copy source. This keeps the install layer cached.
8. Combine package manager steps and remove caches in the same layer (`--no-install-recommends`, delete lists, `--no-cache-dir`).
9. Install only production dependencies in the final stage, and strip dev tools, docs and source maps not needed at runtime.
10. Enable BuildKit cache mounts for package caches where the builder supports it.
11. Rebuild, run the app's tests or a smoke run inside the new image, and compare size with the baseline.
12. Report what saved the most so the next change targets it.

## Gotchas

- Deleting a file in a later layer does not shrink the image. The earlier layer still holds it.
- `COPY . .` before installing dependencies busts the cache with every edit.
- Secrets or credentials copied into a build stage can remain in layer history. Use build secrets mounts.
- Alpine can make builds smaller and runtime slower or broken for native extensions and DNS edge cases. Test before adopting.
- A smaller image that lacks timezone data, certificates or locale files fails in odd ways. Check HTTPS calls and time handling.
- Comparing sizes from different tools (compressed registry size versus local uncompressed) gives false wins.

## Output

- A before and after table of total size and the layers that changed.
- The Dockerfile and ignore file edits.
- Runtime checks run, and risks of the chosen base image.
