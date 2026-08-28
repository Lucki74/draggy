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

**Use tools, when they help.** Draggy can search the web, read a page, drive a
real browser session (navigate, click, fill inputs, read the result back), write
Word, PowerPoint, Excel, code and text files for you, and run short Python or
JavaScript programs to check its own work. Code runs in a scratch directory with
no network access and gets killed after twenty seconds.

**Search your own documents.** Point it at a folder and it indexes the contents
locally with an embedding model, then searches those passages before it searches
the web. Useful for contracts, notes, a codebase, anything you would rather not
upload somewhere.

**Talk to it.** Voice mode listens continuously, works out when you have
actually finished a sentence rather than just paused for breath, and answers out
loud. You can interrupt it mid-sentence and it stops, the way a person would.
Speech recognition runs in the app with Whisper; the voice is either a system
one or a neural voice that runs on your GPU. Voice mode uses its own small model
chosen for how fast it starts speaking rather than how much it knows, because
two seconds of silence is worse than a slightly shorter answer.

**Route the easy decisions to a small model.** A tiny helper model decides
whether a question needs the web, your documents, or nothing at all, so the main
model is not asked to reason about it first.

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

which is typecheck, lint and the test suite in one go. There are around 670
tests and they run in under two seconds, so there is no excuse for skipping
them.

See [RELEASING.md](RELEASING.md) for how versions are tagged and published.

## How it is laid out

```
electron/     main process: windows, IPC, SQLite, search, the embedded
              browser, code execution, updates
src/          the React app
src/agent/    the streaming tool-calling loop
src/tools/    tool definitions and the registry they live in
src/voice/    capture, voice activity detection, turn-taking, speech
src/__tests__ everything that can be tested without a GPU
```

The interesting boundary is `electron/preload.cjs`: the renderer has no Node
access and reaches the filesystem, the network and the database only through the
handful of functions exposed there.

The voice pipeline is worth a look if you are into that sort of thing.
`src/voice/gate.ts` turns a stream of speech probabilities into conversation
events and knows nothing about audio or models, which makes the whole
turn-taking policy testable without a microphone. `src/voice/turnDetector.ts`
decides how long a pause has to be before your turn is over, based on what you
just said — a trailing "um" buys you more time than a full stop does.

## A note on privacy

The only things that reach the internet are: downloading models from Ollama,
web searches you or the model trigger, pages the browser tool opens, the speech
models the first time voice mode runs, and the update check. Everything else is
local. There is no telemetry and nowhere for it to go.

Web search uses DuckDuckGo unless you configure something else. In Settings you
can point it at your own SearxNG instance or give it a Brave API key, and it
falls back through Startpage and a couple of lighter endpoints when a provider
is rate limiting or down.

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
