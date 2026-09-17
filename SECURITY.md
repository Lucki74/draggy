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
  through symlinks or crafted file names, or reading a credentials file (`.env`,
  `.ssh` and the like) that the file tools are meant to refuse.
- A web page, document or extension making Draggy run a tool on its own say-so.
- Getting past a project's permission mode: a change or a command that runs
  without the approval the mode asks for, or a remembered permission that covers
  more than the folder or tool it was given for. An "always allow" for a command
  covers the start of that command only, so a chained, substituted or redirected
  command slipping through under one is a bug.
- A command starting anywhere but the project folder, or outliving the turn
  that was stopped or the app that quit. Once approved, a command can do what
  you can, which is why it is shown to you first.
- A change Draggy made that cannot be undone, or an undo that writes somewhere
  other than the file it came from.
- A repository that makes Draggy run a program just by being looked at. Git
  status and diffs are read with fsmonitor, filters and external tools switched
  off; a way to get one to run anyway is exactly what I want to hear about.
- An extension widget reaching the app's window, the network, or any tool that
  is not read-only.
- The local API, when someone has turned it on, answering anything other than a
  local client with the key, or letting that client reach files, extensions or
  code.
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
- Windows builds are not code signed yet, so SmartScreen warns on first install
  (see [Installation](https://draggy.org/wiki/installation)). That is known,
  and not something a report can speed up.

## After a report

I confirm it, write a test that fails, fix it, and ship a patch release. Then the
advisory goes public with your name on it if you wanted credit. If I decide not
to fix something I will say why rather than letting it go quiet.
