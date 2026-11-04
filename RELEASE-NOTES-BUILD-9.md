**Updates**

- A new permission mode, Turbo, edits, deletes and moves files in the project and runs commands without asking, all inside a sandbox
- On Windows, commands in Ask first, Accept edits and Turbo run in a sandbox. In Ask first and Accept edits the project is read only and there is no network. A command can ask to run outside it
- YOLO runs commands with no sandbox, asks once when you pick it, and can run a command as administrator through the Windows UAC prompt
- Every chat has its own folder with a bundled Python for small scripts. The Files panel opens it, and files open in an editable preview tab
- Code mode uses a shell to list, search, move and delete files, so those four file tools are gone from the Windows app
- Long commands show as one line that expands on click
- The Word, Excel, PowerPoint and PDF skills are always on, and the model loads one before it makes a document
- Commands in Code mode can keep running as background terminal tasks while you keep chatting
- The statistics tab is rebuilt, with a cost section, budgets and editable prices
- Image generation accepts reference images
- Provider model lists refresh on their own
- AMD graphics cards use the ROCm build of llama.cpp when one is published, with no setting to turn on
- The model list shows each model's format
- Embedding models show an icon instead of a second tag
- The message queue card is easier to read and use

**Fixes**

- The question tool works again in chat
- Removed the Use for Chat and Use for Code buttons from model settings
- Removed the ROCm switch and the default shell setting. The shell is picked automatically
- Removed the new chat and extensions hints from settings
