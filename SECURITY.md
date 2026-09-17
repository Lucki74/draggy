# Security

Draggy runs on your machine and talks to a model on your machine. There is no
server, no account and no telemetry, so most of the usual web attack surface
does not exist here. What is left is still worth taking seriously: Draggy reads
web pages, opens files you hand it, runs short programs, and can start extension
servers written by other people. Any of those can carry something hostile.

## Which versions get fixes

The latest release. Draggy is on a fast patch cycle and updates install
themselves, so a fix ships as a new version rather than as a backport.

## Reporting something

Use GitHub's private reporting form:
[Report a vulnerability](https://github.com/Lucki74/draggy/security/advisories/new),
not a public issue. Say what you did, what happened, and what you expected: a
rough proof of concept beats a careful description. Include the Draggy
version and OS if they matter.

This is a one person project, so give me a few days. I will say what I think,
whether I am fixing it, and roughly when; credit in the release notes if you
want it. No bug bounty.

## What I am most interested in

Anything that turns content Draggy reads (a web page, a document, an
extension's output) into actions nobody asked for. Specifically:

- The renderer reaching Node or the filesystem around
  `electron/preload.cjs`, the sandbox's only bridge.
- Reading or writing outside the folders Draggy is supposed to touch, a
  credentials file (`.env`, `.ssh`) the file tools should refuse, or a repo
  that runs a program just by being looked at.
- Running a tool, a command, or an unapprovable edit without the permission
  mode's say-so, or a remembered allowance that covers more than it was given
  for.
- A command or an undo outliving its turn, running outside the project
  folder, or writing somewhere other than where it came from.
- The local API answering anyone but a local, keyed client, or an extension
  widget reaching the window, the network, or a tool that is not read-only.
- The code execution tool escaping its scratch directory or its timeout, or
  extension credentials leaking into a log, crash report, or window title.
- The updater accepting a build that did not come from this repository, or
  the embedded browser leaking a session between the app and a page.

## What is not a vulnerability

- Draggy doing something destructive because you asked it to, or a model you
  installed writing something wrong or rude: that is not Draggy's to police.
- An extension server you enabled doing what it says it does, or anything
  that needs your machine already unlocked.
- Bugs in Ollama, a model, or an extension server; those belong upstream.
- Windows SmartScreen on first install: expected, since builds are not code
  signed yet (see [Installation](https://draggy.org/wiki/installation)).

## After a report

I confirm it, write a test that fails, fix it, and ship a patch release. Then the
advisory goes public with your name on it if you wanted credit. If I decide not
to fix something I will say why rather than letting it go quiet.
