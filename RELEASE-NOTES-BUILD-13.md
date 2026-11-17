**Updates**

- Draggy opens with a small startup window that checks for an update, downloads it with a progress line and restarts into the new version
- During that download you can start without updating, and the app offers the same update later
- After an update, the startup window shows the version you moved to

**Fixes**

- Every skill in the built-in library is installed, where only one of them used to land
- Long messages in Cyrillic, Chinese and other non-Latin scripts are no longer treated as binary data

**Security**

- Commands run as administrator go straight through the Windows UAC prompt, without the hidden PowerShell window that antivirus tools flagged
