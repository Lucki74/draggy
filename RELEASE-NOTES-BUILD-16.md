**Updates**

* macOS builds are paused for now. This build ships for Windows and Linux only, and macOS will come back in a later build.
* Download errors now tell you what to do about a full disk, a folder you can't write to, a bad checksum or a blocked address.
* Skills switched on past the 40th can still be used.

**Fixes**

* Model downloads on Windows no longer fail with "URL refused by outbound security policy".
* Closing or crashing Draggy no longer leaves llama-server or shell processes running.
* MCP tools that only claim to be read-only now ask before they run, and web fetches stop at 16 MiB.
* When several files change at once, every one of them is picked up, so open canvases no longer go stale.
* Enter with an input method editor, Escape in menus and rename, and retry on the crash screen work again.
