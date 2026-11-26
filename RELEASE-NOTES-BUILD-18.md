**Updates**

* API keys now save on every Mac and Linux system. They are encrypted with a key file tied to the machine, so Draggy no longer needs the system keychain.
* On macOS the window uses the system traffic lights, closing the window keeps Draggy running in the Dock, and MCP servers no longer add a second Dock icon.
* Chats can be exported as PDF, and PDF export now works on macOS.
* Settings has a Check for updates button and a Default shell choice for new terminals. Terminals start in your login shell by default.
* MCP servers install with the npm that ships with Draggy, so you no longer need Node.js installed.
* A new Permissions page in Settings, Code has Always allow and Never allow rules for commands, paths, tools and websites, in every project or just one. Never allow wins in every mode, auto included.
* Any model can be deleted from Settings, Models, even the one in use, and embedding models no longer show up as chat models.

**Fixes**

* The browser pane's address bar, back and forward buttons work on macOS and Linux.
* Folders that are not Git repositories no longer fill the log with Git errors.
