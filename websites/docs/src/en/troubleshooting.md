---
title: "Troubleshooting"
description: "Common problems and what fixes them."
section: fix
---

## It will not get past the splash screen

The first launch downloads a model, between about 0.5 GB and 240 GB depending on the hardware. How long that takes depends on your connection. Check the connection, and check that you have 1.5 times the model's size free on disk.

## Replies are extremely slow

Turn on **Show speed and memory** in `Settings → General` and read the GPU figure. A low GPU share means the model is spilling onto the processor, so step down a size in `Settings → Models`.

## The model describes a tool call instead of making one

If a tool call fails, turn off the tools you do not need, then send the message again.

## An extension will not start

| Message | Means |
| --- | --- |
| Not configured yet | A required field is empty. Open the setup fields. |
| Did not answer in time | The server did not answer in time, so Draggy stopped waiting. |
| npm could not be found | Install Node.js and restart Draggy. |

## Voice mode will not start

If Draggy says it can't use the microphone, allow it in your system's privacy settings. If it says **No speech voices are installed on this system**, add one in your system's settings, or use the **Natural** voice instead.

## A command failed for lack of access or network

On Windows, commands run in a [sandbox](doc:permissions#sandbox). In **Ask first** and **Accept edits** the project folder is read only there and there is no network, so something like `npm install` fails. The model can ask to run that one command outside the sandbox, and you answer on a card. **Turbo** allows writes and the network inside the sandbox.

## It refused a file path or a local address

The model may only reach the project folder, and may only fetch public `http` and `https` addresses. Attach the file yourself, or open the page in the browser.

## Updates never appear

Updates only run in an installed build. Builds run from source do not update.

## Still stuck

`Settings → Diagnostics → Open log folder` opens the logs. **`app.log`** holds events, with prompts and secrets reduced. For a bug report, use `Settings → Diagnostics → Export diagnostics`, which also replaces your home folder and user name. Then [open an issue](https://github.com/Lucki74/draggy/issues) with the message you saw.
