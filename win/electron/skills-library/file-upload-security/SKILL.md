---
name: file-upload-security
description: Reviews or designs a file upload path: size and type limits, content sniffing, safe naming, storage outside the web root, safe serving headers, image reprocessing and scanning. Use when the user asks to secure uploads, review an upload endpoint, or add avatars, attachments or document import.
---

# File upload security

## Goal

Accept the files the product needs, and make sure an uploaded file cannot run, overwrite other files, or attack other users.

A good design treats the filename, the type and the content as untrusted, and serves files in a way that cannot execute them.

## When to use

- The app accepts images, documents, archives or any user file.
- Uploaded files are served from the same domain as the app.
- A scanner flagged unrestricted upload.
- For general input checks, use `use_skill` with `input-validation-audit`.

## Steps

1. Find the upload code with `search_files` for `multipart`, `upload`, `multer`, `FormData`, `request.files`, `save(` and storage SDK calls. Read each handler with `read_file`.
2. Set a hard maximum size at the proxy and the app, and a file count limit. Stream to storage, not into memory.
3. Allow only the extensions and media types the feature needs, by allow list. Compare the declared type, the extension and the real content (magic bytes) and reject mismatches.
4. Ignore the client filename. Generate a random name, keep the extension from your own allow list, and store the original name as metadata only.
5. Store outside the web root, or in object storage with no public execute behaviour. Never place uploads where the server runs scripts.
6. For images, decode and re-encode with a maintained library to drop embedded payloads and metadata, and cap the pixel dimensions to avoid decompression bombs.
7. For archives, check entry paths for `..` and absolute paths (zip slip), total uncompressed size and entry count before extraction.
8. Serve safely: separate cookieless domain if possible, `Content-Disposition: attachment` for documents, correct `Content-Type`, `X-Content-Type-Options: nosniff`, and never serve user HTML or SVG inline from the app origin.
9. Add malware scanning for files that other users download, using a scanner service or ClamAV through a queue, and hold files as pending until clean.
10. Check access control: only the owner or permitted users can fetch a file, and ids are not guessable. Use signed, expiring URLs for private files.
11. Add quotas per user and rate limits, and clean up abandoned partial uploads.
12. Write tests with a renamed script file, a zip with `../`, an oversized file and a polyglot image, and report the results.

## Gotchas

- The `Content-Type` header and the extension are chosen by the client. Neither proves what the file is.
- SVG is XML that can carry script. Serve it as a download or sanitise it, never inline on your origin.
- Image libraries have had parsing bugs. Keep them updated and process files in a restricted worker.
- Path joins with the user's filename allow overwrite of files like config. Do not use it in the path.
- Public buckets with a guessable key become a data leak. Check bucket policy and listing settings.
- Virus scanning finds known malware only. It does not replace the other controls.

## Output

- Findings or design table: control, present or missing, fix.
- Code changes and the tests added.
- How files are stored and served, in two lines.
