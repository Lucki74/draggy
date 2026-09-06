<img width="96" height="96" alt="icon_light" src="https://github.com/user-attachments/assets/746650c8-1251-443f-a323-43ed7dee89ec"/>

# Draggy

Draggy is a desktop AI assistant that talks, browses and works with your files,
all on models running on your own computer.

It drives a local [Ollama](https://ollama.com) instance, so there is no account,
no API key, and no request leaving the machine unless you ask for one. An
Electron app, in React and TypeScript, for Windows, macOS and Linux.

Full documentation is in the [wiki](https://github.com/Lucki74/draggy/wiki).

## What it does

- **Chat with a local model.** Draggy sizes a model to your graphics card on
  first launch and downloads it. Three answering modes, swappable models.
- **Use tools.** Web search, reading a page, and driving a real browser session.
  It writes Word, PowerPoint, Excel, PDF, code and text files, reads them back
  when you attach one, and runs short Python and JavaScript in a sandbox.
- **Browse without ads.** Links open in a browser window inside the app, with
  uBlock Origin's engine and filter lists, YouTube adverts and anti-adblock
  walls included.
- **Search your own documents.** Point it at a folder and it indexes the
  contents locally, on meaning and keywords at once.
- **Extend it.** Thirty-four Model Context Protocol servers in a catalogue,
  none on by default.
- **Talk to it.** Continuous voice mode that works out when you have finished a
  sentence, answers out loud, and stops when you cut in.
- **Export a conversation.** Any chat to Markdown, from the history list.

## Requirements

Ollama has to be installed and running. Draggy will offer to install it if it
cannot find it.

### Minimum
| | |
| --- | --- |
| System | Windows 10 64-bit (1809 or newer), macOS 11, 64-bit Linux with glibc 2.28 or newer |
| Processor | Intel Core i5-8250U, AMD Ryzen 3 3200U, Apple M1 |
| Memory | 8 GB |
| Graphics | Intel UHD 620, AMD Radeon Vega 8 |
| Disk | 10 GB free |

At this end the model runs on the processor at a few words a second, and
anything under about 4B parameters is unreliable at calling tools.

### Recommended
| | |
| --- | --- |
| System | Windows 11, macOS 14, Newest Linux |
| Processor | Intel Core i5-12400, AMD Ryzen 5 5600, or Apple M2 |
| Memory | 16 GB |
| Graphics | GeForce RTX 3070, Radeon RX 7600, Intel Arc A750 |
| Disk | 20 GB free (SSD) |

Eight gigabytes of VRAM is where Draggy picks Qwen 3 8B, the smallest model that
holds a conversation and calls tools reliably.

## Installing

Download the installer from the
[Releases page](https://github.com/Lucki74/draggy/releases) and run it. Draggy
updates itself in the background and offers to install on the next launch.

Nothing is code signed, which is a certificate I have not bought rather than
anything wrong with the build. Windows shows a SmartScreen warning: **More
info**, then **Run anyway**. macOS needs the quarantine flag cleared with
`xattr -cr /Applications/Draggy.app`, and cannot update itself. Each release
includes a SHA-512 if you would rather check than trust.

## Building it yourself

```bash
npm install
```

```bash
npm run electron:dev
```

Vite and Electron together with hot reload. `npm run electron:build` produces an
installer in `dist-electron`, and `npm run check` is typecheck, lint and around
990 tests in a few seconds. See [CONTRIBUTING.md](CONTRIBUTING.md) before
sending a patch, and [RELEASING.md](RELEASING.md) for how versions are cut.

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

Two boundaries matter. `electron/preload.cjs` is the security one: the renderer
has no Node access and reaches the filesystem, network and database only through
what is exposed there. The second is the session split, with Draggy's own window
under a strict Content Security Policy and every external page on a separate
partition with no policy of ours imposed on it.

Quitting stops everything Draggy started: browser windows, extension servers, a
code run still going, and Ollama if Draggy was the one that started it.

[Architecture](https://github.com/Lucki74/draggy/wiki/Architecture) has the rest.

## Privacy

The only things that reach the internet are model downloads, searches you or the
model trigger, pages the browser opens, the speech models on first use, the ad
blocker's filter lists, site icons for search results, the update check, and any
extension you switch on. Everything else is local. There is no telemetry and
nowhere for it to go.

## Languages

English, French, Spanish, German, Italian, Portuguese, Dutch, Russian, Chinese,
Japanese, Korean and Arabic. Whether the model answers in your language depends
on the model, not on Draggy.

## Known rough edges

- Voice mode is beta. It wants a decent GPU and a headset; over laptop speakers
  the model will occasionally answer itself.
- macOS builds are unsigned, so they need the quarantine flag cleared and cannot
  update themselves.
- Tool calling quality varies a lot by model, and small models get it wrong.
- A long conversation is condensed into notes as it approaches the context
  window. The messages stay on screen and stay searchable; the model works from
  the summary.

## License

GNU General Public License v3.0 or later. See [LICENSE](LICENSE).

Draggy is free software: you may use, study, change and share it. If you pass it
on, modified or not, you have to pass those same freedoms on with it and make
your source available under the same licence. There is no warranty, to the
extent the law allows.
