**Updates**

- The Windows app now runs on Tauri instead of Electron. Your settings, chats and saved keys carry over, and the old install is removed after the upgrade
- Agent commands on Windows run in a sandbox that only sees the project folder and the toolchains on your PATH
- npm, npx, vitest and other Node tools ask once and then run outside the sandbox, where they work
- Always allow now covers a command prefix, so allowing `npm run` covers every script
- The browser pane blocks more ads, including scriptlet filters, and its popped-out window has a bar of its own
- Window controls are drawn in the app's title bar

**Fixes**

- Node commands no longer hang in the sandbox and get retried for dozens of steps
- The administrator prompt for the sandbox appears once per machine, not at every launch
- Sandboxed commands can list the folders above the project, so PowerShell and `dir` work there
