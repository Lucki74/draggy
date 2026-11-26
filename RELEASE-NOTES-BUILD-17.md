**Updates**

* Draggy now runs on the same Tauri app on Windows, macOS and Linux, with one look, shell and setup everywhere.
* macOS is back as one universal app for Apple silicon and Intel Macs running macOS 14 or newer. It is signed ad hoc, so clear the quarantine flag or use right click, Open the first time.
* Linux gets an AppImage next to the .deb and .rpm packages.
* Every platform now updates itself from its own signed feed. Windows users on build 16 need to install build 17 by hand once; later builds arrive on their own.
* Video tools on macOS and Linux use a bundled ffmpeg, so you no longer need to install one.
* API server settings are easier to read and set up.

**Fixes**

* Adding a Custom (OpenAI-compatible) provider works again.
* Free disk space shows the right number on macOS.
* Chat stays visible when you drag the side pane wide.
* Web searches no longer come back empty when a search engine shows a bot check.
