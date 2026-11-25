---
title: "Tools and capabilities"
description: "Search, the browser, documents, files and running code."
section: control
---

## Making files

Word from Markdown, PowerPoint with a heading per slide, Excel from CSV or HTML, and PDFs typeset by the browser engine. Attach any of them back and Draggy reads them. A scanned PDF has no text to extract, and Draggy says so.

The Word, Excel, PowerPoint and PDF skills are always on and cannot be switched off. The model loads the right one before it writes the file.

Executable and script file types are refused when a document is made or a file is opened. Scripts and installers open in their folder instead of running.

## Running code

The agent runs shell commands and scripts in the project folder through the terminal pane. On Windows they run in a [sandbox](doc:permissions#sandbox). Every command runs under the active permission mode, with output streamed into the terminal and transcript. A long one moves to a background task, which the model can read, wait for or stop.

## The chat folder

On Windows, each conversation in Chat has its own folder. Files the model creates are saved there, and its commands run there, always in the [sandbox](doc:permissions#sandbox) and with no network. A Python that ships with Draggy is available, so scripts run without installing anything. **Open chat folder** opens it in Explorer, the Files pane lists what is in it, and a file opens in a preview tab you can edit. The folder is removed with the chat.

## Your own documents

Point `Settings → Chat → Library` at a folder and its contents are indexed on your machine, then searched by meaning.

## Turning things off

A tool that is not available right now is left out of the list the model sees. Web search is off when you set it to **Off**, and the web tools go with it.
