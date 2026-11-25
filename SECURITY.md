# Security

Draggy runs on your computer and, unless you add a provider, talks to a model on your computer. There's no server, no account and no telemetry, so most of the usual web attack surface just isn't there.

The only background request is the price refresh for the cost counters. It's a GET to three fixed public URLs, it carries nothing from your chats, and you can turn it off in Settings. Packaged builds also check GitHub Releases for updates, and that one can't be turned off.

What's left still matters though. Draggy reads web pages, opens files you give it, runs short programs and can start extension servers written by other people. Any of those can carry something hostile.

## Which versions get fixes

The latest build. Packaged builds update themselves on Windows and Linux, so a fix ships as a new build, not as a backport.

## Reporting something

Please use GitHub's private form, [Report a vulnerability](https://github.com/Lucki74/draggy/security/advisories/new), and not a public issue. Tell me what you did, what happened and what you expected. A rough proof of concept beats a careful description. Add the Draggy build number (it's shown in the app) and your OS if they matter.

I'm one person, so give me a few days. I'll tell you what I think, whether I'm fixing it and roughly when. You get credit in the release notes if you want it. There's no bug bounty.

## What I care about most

Anything that turns content Draggy reads (a web page, a document, an extension's output) into actions nobody asked for. For example:

- The webview reaching the filesystem or a command through the Tauri IPC bridge. Only the `main` webview gets IPC (`app/src-tauri/capabilities/main.json`). Browser pane webviews get nothing (`browser-pane.json`).
- Reading or writing outside the folders Draggy is supposed to touch, a credentials file (`.env`, `.ssh`) the file tools should refuse, or a repo that runs a program just by being looked at.
- Running a tool, a command or an edit without the permission mode allowing it, or a remembered allowance covering more than it was given for.
- A command or an undo outliving its turn, running outside the project folder, or writing somewhere other than where it came from.
- A command escaping the Windows sandbox (the AppContainer launcher in `app/sandbox/`), or running outside it without the user saying yes.
- The local API answering anyone other than a local client with the key, or an extension widget reaching the window, the network, or a tool that isn't read-only.
- The code execution tool escaping its scratch directory or its timeout, or extension credentials leaking into a log, a crash report or a window title.
- The updater accepting a build that didn't come from this repo, or the embedded browser leaking a session between the app and a page.
- The `draggy-ai://` model gateway answering anything other than Draggy's own window, or fetching anywhere other than a provider you added and turned on.
- A provider's API key or the Brave Search key leaving the system keystore: reaching the renderer, a URL, a log, or a plain text file.
- A provider's own hosted tools (web search, code execution) running on a request Draggy sent.
- A cloud image or voice request (`app/src-tauri/src/images/cloud/`, `app/src-tauri/src/tts/cloud/`) going anywhere other than the provider the user picked, or its key reaching the renderer.
- A cloud voice getting reply text without a grant for that provider.
- A picture from the web shown in an answer loading anything other than the image itself.
- The image engine accepting an engine archive or model without the SHA-256 pinned in the app, unpacking an archive entry outside its folder, or writing an image outside the project or output folder it was meant for.
- The large-model engine running a colibri archive or the private Python runtime that failed its hash check, accepting a model file that doesn't match the manifest, its gateway listening on anything other than `127.0.0.1`, or a diagnostics report containing a prompt or a reply.

## Known gaps

I'd rather say these out loud than hide them.

Builds aren't code signed. The Windows updater checks each update against a minisign key whose private half only lives in this repo's secrets. On Linux, the checksums in `SHA256SUMS.txt` come from the same release as the package, so they catch corruption but not tampering. There, write access to the releases is the trust boundary.

colibri is pinned to one release (`RELEASE` in `core/crates/engine/src/colibri_runtime.rs`), and each archive is checked against the `SHA256SUMS.txt` published next to it. That proves the download is intact, not that the upstream release is trustworthy. The Python runtime is pinned by hash on Windows and Linux.

The colibri gateway runs without a key on a free `127.0.0.1` port for as long as a large model is loaded.

`sd-server` listens on `127.0.0.1` with no key and answers any origin, which is how it works upstream. Draggy gives it a random port on each start and stops it as soon as its queue is empty, but a page open in the embedded browser during that time could send it work. Draggy never points it at one of your files, so if you find a way to make it read or write one, that's exactly the report I want.

## What isn't a vulnerability

- Draggy doing something destructive because you asked it to, or a model you installed writing something wrong or rude. That's not Draggy's to police.
- An extension server you turned on doing what it says it does, or anything that needs your computer already unlocked.
- Bugs in llama.cpp, a model or an extension server. Those belong upstream.
- Windows SmartScreen on first install. That's expected since builds aren't code signed yet (see [Installation](https://docs.draggy.org/installation)).

## After a report

I confirm it, write a test that fails, fix it and ship a new build. Then the advisory goes public, with your name on it if you wanted credit. If I decide not to fix something, I'll tell you why instead of letting it go quiet.
