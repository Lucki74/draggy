**Updates**

- macOS and Linux builds are back in the automated release workflow alongside Windows, producing native packages on each release
- An embedded terminal pane opens in the dock with shortcuts Ctrl+Shift+T on Windows or Linux and Cmd+Shift+T on macOS, supporting multiple tabs and custom shells
- Code blocks in chat have a button to run commands directly in the terminal
- The Diff pane adds History and Branches tabs to inspect commits and switch local branches
- Added shortcuts to open the Terminal with Ctrl+Shift+T, open the Plan with Ctrl+Shift+L, and close the active dock pane with Ctrl+\
- Chats can be exported to Markdown or standalone HTML from the sidebar menu, including thinking steps, tool activity, diffs, and metrics
- Follow-up messages can be queued while a reply generates, with Enter to queue, Ctrl+Enter to send next turn, and Ctrl+Shift+Enter to send immediately; queued messages persist across restarts
- When a reply reaches the context limit and the model has room, Draggy automatically expands the window to the next size bucket and continues generating
- Interrupted replies can be resumed if the app closes during generation
- Error notices specify whether a failure came from the model engine, memory limits, network drops, or rate limits
- Work summary blocks show counts of files created, moved, and deleted
- Added provider icons for Nebius, Novita, SambaNova, SiliconFlow, and custom endpoints
- Added BountyGuard to the MCP catalogue

**Fixes**

- Fixed an issue where conversations could reset or drop messages during turn transitions
- Rewrote the diff parser to handle multi-file diffs, untracked files, and mixed line endings cleanly
- Fixed context meter totals on multi-pass agent turns to avoid double-counting earlier passes
- Fixed race conditions when stopping a generation turn
- Updated bundled Electron, undici, and fast-uri dependencies

### New Contributors

* @doomsday-network made their first contribution in https://github.com/Lucki74/draggy/pull/114

**Full Changelog**: https://github.com/Lucki74/draggy/compare/b-6...b-7
