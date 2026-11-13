---
name: file-upload-handling
description: Implements file uploads with size limits, content checks, safe naming, streaming to storage and safe serving. Use when the user asks to add file upload, upload images to an API, or secure existing file uploads.
---

# File upload handling

## Goal

Accept user files without letting them exhaust memory, overwrite other files, run code or be served in a harmful way. A good result enforces limits early, stores files outside the code path and serves them with safe headers.

## When to use

- A feature needs users to upload images, documents or archives.
- An existing upload route is suspected to be unsafe or to fall over on large files.
- For wider security review of a change, use `use_skill` with `security-review`.
- For processing the file after upload, use `use_skill` with `background-jobs`.

## Steps

1. Decide the requirements with the user: allowed types, maximum size, how many files, who can upload and who can read, and how long files live. Use `ask_user` for unclear points.
2. Read how the framework handles multipart bodies with `read_file` and the docs via `read_url`. Pick a streaming parser that spills to disk or passes the stream on, instead of reading whole files into memory.
3. Enforce limits at the earliest point: a body size limit at the proxy or server, a per-file limit in the parser, and a file count limit. Return 413 when exceeded.
4. Validate the content, not the claim. Do not trust the client's content type or the file extension. Check the leading bytes (magic numbers) against the allowed types, and for images consider decoding and re-encoding to strip embedded payloads and metadata.
5. Generate the storage name yourself: a random id plus a safe extension from your allowlist. Never use the client filename in a path. Keep the original name only as metadata, escaped on display.
6. Store files outside the web root, preferably in object storage. Keep a database record with owner, size, detected type, checksum and storage key.
7. Consider scanning for malware where users share files with each other, as an asynchronous step before the file is made available.
8. Serve safely: authorize every download, set the correct `Content-Type`, send `X-Content-Type-Options: nosniff`, and use `Content-Disposition: attachment` for types that should not render inline. Serve user content from a separate domain if it can contain HTML or SVG.
9. Clean up: remove partial uploads after a failure and orphan files on a schedule.
10. Test with oversized files, wrong types renamed with allowed extensions, filenames with path separators and zero-byte files using `run_command`.

## Gotchas

- A path built from the uploaded filename allows `../` traversal and overwriting of files. Never use client names for paths.
- Reading the whole upload into memory lets a few large requests crash the process.
- Checking only the extension lets an HTML or script file pass as an image. SVG can contain script and must be treated as active content.
- Files served from the app's own origin with a guessable path leak private documents. Authorize each request or use short-lived signed URLs.
- Archives (zip) can expand to enormous sizes or contain paths that escape the target folder. Limit expansion and sanitize entries.
- Image processing libraries have had parser vulnerabilities. Keep them updated and process in a restricted context.

## Output

- The limits and allowed types chosen.
- The handler, storage and serving changes by file.
- The tests run and risks left, such as no malware scanning.
