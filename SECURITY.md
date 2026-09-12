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
[Report a vulnerability](https://github.com/Lucki74/draggy/security/advisories/new).
It stays between us until there is a fix.

Please do not open a public issue for anything exploitable. If you are not sure
whether something counts, report it privately anyway and we can decide together.

Tell me what you did, what happened, and what you expected instead. A rough
proof of concept is worth more than a careful description. Include the Draggy
version, the operating system, and the model you were running if it matters.

This is a one person project, so give me a few days to reply. I will tell you
what I think, whether I am fixing it, and roughly when. If you want credit in
the release notes, say so and you will get it. There is no bug bounty; I am not
going to pretend otherwise.

## What I am most interested in

Anything that turns content Draggy reads into actions you did not ask for. The
model sees web pages, PDFs, spreadsheets, documents from your library and output
from extension servers, and none of that is trustworthy input.

Specifically:

- The renderer reaching Node or the file system. The app window runs sandboxed
  with context isolation and `electron/preload.cjs` is the only bridge, so a way
  around that is the most serious thing you could find.
- Writing or reading outside the folders Draggy is supposed to touch, including
  through symlinks or crafted file names.
- A web page, document or extension making Draggy run a tool on its own say-so.
- The code execution tool escaping its scratch directory, reaching the network,
  or outliving the timeout.
- Credentials for an extension server leaking somewhere they should not be:
  a log file, a crash report, the window title, another server.
- The updater accepting a build that did not come from this repository's
  releases.
- The embedded browser leaking a session between the app and a page, or a page
  reaching the app's own context.

## What is not a vulnerability

- Telling Draggy to do something destructive and watching it comply. Draggy does
  what you ask it to.
- A model you installed writing something wrong, rude or dangerous. Draggy does
  not police the weights you run, though a jailbreak that only works through
  Draggy's own prompts is still worth telling me about.
- An extension server you enabled doing exactly what it says it does. Enabling
  one runs someone else's code on purpose, which is why they all start switched
  off and say what they need.
- Anything that needs someone to already have your unlocked machine.
- Bugs in Ollama, in a model, or in an extension server. Those belong upstream,
  though I would rather hear about them twice than not at all.
- Windows builds are not code signed yet, so SmartScreen warns on first install.
  That is known, and not something a report can speed up.

## After a report

I confirm it, write a test that fails, fix it, and ship a patch release. Then the
advisory goes public with your name on it if you wanted credit. If I decide not
to fix something I will say why rather than letting it go quiet.
