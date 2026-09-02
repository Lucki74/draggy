<img width="96" height="96" alt="icon_light" src="https://github.com/user-attachments/assets/746650c8-1251-443f-a323-43ed7dee89ec"/>

# Draggy

Draggy is a desktop AI assistant that runs the model on your own computer. No
account, no API key, no request leaving the machine unless you ask for one. It
talks to [Ollama](https://ollama.com) running locally, and everything else —
your chats, your files, your settings, the documents you index — stays on disk
where you put it.

It is an Electron app, built with React and TypeScript, for Windows, macOS and
Linux.

## What it does

**Chat with a local model.** On first launch Draggy looks at how much VRAM your
graphics card has and picks a model that will actually fit, then downloads it.
An 8 GB card gets Qwen 3 8B; a laptop with 2 GB gets something much smaller. You
can override the choice at any time, and swap models mid-conversation.

Three answering modes sit on the chat toolbar. Balanced and Deep let the model
reason before it replies; Fast turns reasoning off outright rather than asking
for less of it, which on a small model is the difference between a one-word
question costing one second and costing eight.

**Use tools, when they help.** Draggy can search the web, read a page, and
drive a real browser session — navigate, click, fill inputs, read the result
back. It writes Word, PowerPoint, Excel, PDF, code and plain text files, and
reads those same formats back when you attach one. PDFs are typeset through the
browser engine the app already ships, so a document comes out with real
headings, tables and page numbers rather than a wall of text. It also runs short
Python and JavaScript programs to check its own work, in a scratch directory
with no network access, killed after twenty seconds.

**Browse, with the ads gone.** Links open in a browser window inside the app,
with back, forward, reload and an address bar. Ad and tracker blocking runs on
uBlock Origin's engine and its filter lists, and there is a switch in the
toolbar to turn it off for a site that needs it.

**Search your own documents.** Point it at a folder and it indexes the contents
locally — PDFs, Word, PowerPoint, Excel, Markdown, source code and plain text —
with an embedding model sized to your VRAM the same way the chat model is, or
one you pick yourself. Questions about your own material are searched there
before the web. Search runs on meaning and on keywords at once and fuses the
two, so a paraphrase and an exact part number both find the right passage.
Useful for contracts, notes, a codebase, anything you would rather not upload
somewhere.

**Extend it, if you want to.** Draggy speaks the Model Context Protocol, so it
can borrow tools from servers other people wrote — GitHub, Slack, Notion,
Postgres, Playwright, a folder on disk, thirty-nine of them in a catalogue in
Settings. Nothing is on by default: an extension is a program that runs on your
machine with the credentials you give it, which is a real decision, so you make
it one server at a time.

**Talk to it.** Voice mode listens continuously, works out when you have
actually finished a sentence rather than just paused for breath, and answers out
loud. You can interrupt it mid-sentence and it stops, the way a person would.
Speech recognition runs in the app with Whisper; the voice is either a system
one or a neural voice that runs on your GPU. Voice mode uses its own small model
chosen for how fast it starts speaking rather than how much it knows, because
two seconds of silence is worse than a slightly shorter answer.

## Requirements

Ollama has to be installed and running. Draggy will offer to install it if it
cannot find it.

A GPU with 4 GB of VRAM or more is where this starts being pleasant. It will run
on less — it will pick smaller models and lean on the CPU — but a 3B model
answering at four tokens a second is not a good time. Apple Silicon works well
because the memory is shared.

Budget 10 GB of disk for a typical model, plus a few hundred megabytes for the
speech models if you use voice mode.

## Installing

Download the installer from the
[Releases page](https://github.com/Lucki74/draggy/releases) and run it. Draggy
checks for new versions on its own and installs them when you quit, unless you
turn that off in Settings.

Windows will show a SmartScreen warning about an unknown publisher: click **More
info**, then **Run anyway**. The installer is not code signed, which is a
certificate I have not bought rather than anything Windows found wrong with it.
If you would rather check than trust, the release includes a SHA-512 for the
installer, and building from source is a few commands below.

## Building it yourself

```bash
npm install
```

```bash
npm run electron:dev
```

That starts Vite and Electron together with hot reload. For a production
installer:

```bash
npm run electron:build
```

The result lands in `dist-electron`. Before committing anything, run:

```bash
npm run check
```

which is typecheck, lint and the test suite in one go. There are around 920
tests and they run in under two seconds. CI runs the same command on every push
and pull request, but it is faster to find out before you push.

See [CONTRIBUTING.md](CONTRIBUTING.md) if you are thinking of sending a patch,
and [RELEASING.md](RELEASING.md) for how versions are tagged and published.

## How it is laid out

```
electron/     main process: windows, IPC, SQLite, search, the embedded
              browser, code execution, MCP servers, updates
src/          the React app
src/agent/    the streaming tool-calling loop, and conversation compaction
src/chat/     the message list and the rules for what can be attached
src/settings/ the settings panels
src/tools/    tool definitions and the registry they live in
src/voice/    capture, voice activity detection, turn-taking, speech
src/__tests__ everything that can be tested without a GPU
```

The interesting boundary is `electron/preload.cjs`: the renderer has no Node
access and reaches the filesystem, the network and the database only through the
handful of functions exposed there.

The second boundary is the session split. Draggy's own window runs on Electron's
default session under a strict Content Security Policy; every external page —
whether you opened it or the model did — runs on a separate partition with no
policy of ours imposed on it. Forcing `default-src 'self'` onto someone else's
site blocks their scripts, styles, video and forms, which is a fine way to make
a browser useless. Sharing that one partition between your browsing and the
model's page reads is also what lets a verification check you pass by hand
carry over to what the model can read afterwards.

The voice pipeline is worth a look if you are into that sort of thing.
`src/voice/gate.ts` turns a stream of speech probabilities into conversation
events and knows nothing about audio or models, which makes the whole
turn-taking policy testable without a microphone. `src/voice/turnDetector.ts`
decides how long a pause has to be before your turn is over, based on what you
just said — a trailing "um" buys you more time than a full stop does.

## A note on privacy

The only things that reach the internet are: downloading models from Ollama,
web searches you or the model trigger, pages the browser tool opens, the speech
models the first time voice mode runs, the ad blocker's filter lists (fetched
once and cached on disk), the icon of each site that appears in a search result
— asked of that site directly, never of a third-party favicon service — the
update check, and any MCP extension you switch on, which fetches its package
from npm and then talks to whatever service it is for. Everything else is local. There is no telemetry and nowhere for
it to go.

Web search defaults to automatic: your own SearXNG instance if you have set one
up, then Brave's API if you have supplied a key, then DuckDuckGo, Startpage and
two lighter fallbacks, tried in order until one answers. You can also pin it to
a specific provider — Brave Search, DuckDuckGo, Startpage, Brave's API or
SearXNG — in Settings.

## Languages

The interface is translated into English, French, Spanish, German, Italian,
Portuguese, Dutch, Russian, Chinese, Japanese, Korean and Arabic. Whether the
model answers in your language depends on the model, not on Draggy.

## Known rough edges

Voice mode is new and marked beta in the interface. It works well with a decent
GPU and a headset; over laptop speakers the echo cancellation has to work harder
and the model will occasionally answer itself.

macOS builds are not signed yet, which means they install fine but cannot update
themselves.

Tool calling quality varies a lot by model. Anything under about 4B parameters
will describe a tool call instead of making one often enough to be annoying.

A long conversation is folded down as it goes: once it approaches the size of
the context window, the older half is condensed into notes and a line appears
in the transcript saying so. The messages themselves are never touched — they
stay on screen and stay searchable — but the model is working from a summary of
them from that point on. The fold happens while you are reading the last reply,
never while you are waiting for the next one.

## License

GNU General Public License v3.0 or later — see [LICENSE](LICENSE).

Draggy is free software: you may use, study, change and share it. If you pass
it on, modified or not, you have to pass those same freedoms on with it and
make your source available under the same licence. There is no warranty, to
the extent the law allows.
