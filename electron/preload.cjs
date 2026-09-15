const { contextBridge, ipcRenderer } = require("electron");

/** Several parts of the app can share a channel, so the disposer removes only this listener and
 * neither can silence the other. */
const subscribe = (channel, callback) => {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

/** What the window runs before Draggy quits. It answers with none registered too, so a quit from
 * the startup screen does not sit out the timeout. */
const beforeQuit = new Set();
ipcRenderer.on("app:flush-saves", async () => {
  await Promise.allSettled([...beforeQuit].map(async (handler) => handler()));
  ipcRenderer.send("app:saves-flushed");
});

contextBridge.exposeInMainWorld("electronAPI", {
  getSystemSpecs: () => ipcRenderer.invoke("get-system-specs"),
  checkOllama: () => ipcRenderer.invoke("check-ollama"),
  startOllama: () => ipcRenderer.invoke("start-ollama"),
  modelInUse: (name) => ipcRenderer.send("model-in-use", name),
  installOllama: () => ipcRenderer.invoke("install-ollama"),
  checkInternet: () => ipcRenderer.invoke("check-internet"),
  checkDiskSpace: () => ipcRenderer.invoke("check-disk-space"),

  searchWeb: (query) => ipcRenderer.invoke("search-web", query),
  searchWebDetailed: (query) => ipcRenderer.invoke("search-web-detailed", query),
  setSearchConfig: (config) => ipcRenderer.invoke("set-search-config", config),
  readUrl: (url) => ipcRenderer.invoke("get-page-content", url),

  browserNavigate: (url) => ipcRenderer.invoke("browser-navigate", url),
  browserGetElements: () => ipcRenderer.invoke("browser-get-elements"),
  browserClick: (index) => ipcRenderer.invoke("browser-click", index),
  browserType: (index, text) => ipcRenderer.invoke("browser-type", index, text),
  browserPressKey: (key) => ipcRenderer.invoke("browser-press-key", key),
  browserGetText: () => ipcRenderer.invoke("browser-get-text"),
  browserClose: () => ipcRenderer.invoke("browser-close"),

  createFile: (filename, content) => ipcRenderer.invoke("create-file", filename, content),
  openFile: (filepath) => ipcRenderer.invoke("open-file", filepath),
  openCreatedFiles: () => ipcRenderer.invoke("open-created-files"),
  listCreatedFiles: () => ipcRenderer.invoke("list-created-files"),
  readCreatedFile: (filepath) => ipcRenderer.invoke("read-created-file", filepath),
  revealCreatedFile: (filepath) => ipcRenderer.invoke("reveal-created-file", filepath),
  deleteCreatedFile: (filepath) => ipcRenderer.invoke("delete-created-file", filepath),
  readDocument: (filename, data) => ipcRenderer.invoke("read-document", filename, data),

  searchModels: (query) => ipcRenderer.invoke("search-models", query),
  modelSize: (name, tag) => ipcRenderer.invoke("model-size", name, tag),

  db: {
    loadChats: () => ipcRenderer.invoke("db:load-chats"),
    saveChat: (session) => ipcRenderer.invoke("db:save-chat", session),
    deleteChat: (id) => ipcRenderer.invoke("db:delete-chat", id),
    clearChats: () => ipcRenderer.invoke("db:clear-chats"),
    searchChats: (query) => ipcRenderer.invoke("db:search-chats", query),
    get: (key) => ipcRenderer.invoke("db:get", key),
    set: (key, value) => ipcRenderer.invoke("db:set", key, value),
    importSessions: (sessions) => ipcRenderer.invoke("db:import", sessions),
    stats: () => ipcRenderer.invoke("db:stats"),
  },

  files: {
    list: (workspaceId, path) => ipcRenderer.invoke("fs:list", workspaceId, path),
    read: (workspaceId, path) => ipcRenderer.invoke("fs:read", workspaceId, path),
    write: (workspaceId, path, contents, chatId) =>
      ipcRenderer.invoke("fs:write", workspaceId, path, contents, chatId),
    edit: (workspaceId, path, find, replace, expected, chatId) =>
      ipcRenderer.invoke("fs:edit", workspaceId, path, find, replace, expected, chatId),
    move: (workspaceId, from, to, chatId) =>
      ipcRenderer.invoke("fs:move", workspaceId, from, to, chatId),
    remove: (workspaceId, path, chatId) =>
      ipcRenderer.invoke("fs:delete", workspaceId, path, chatId),
    search: (workspaceId, query) =>
      ipcRenderer.invoke("fs:search", workspaceId, query),
    checkpoints: (workspaceId) =>
      ipcRenderer.invoke("checkpoint:list", workspaceId),
    revert: (id) => ipcRenderer.invoke("checkpoint:revert", id),
    onChanged: (callback) => subscribe("file-changed", callback),
  },

  apiServer: {
    status: () => ipcRenderer.invoke("api-server:status"),
    configure: (config) => ipcRenderer.invoke("api-server:configure", config),
    regenerateKey: () => ipcRenderer.invoke("api-server:regenerate-key"),
    ready: () => ipcRenderer.send("api-server:ready"),
    onRequest: (callback) => subscribe("api-server:request", callback),
    onAbort: (callback) => subscribe("api-server:abort", callback),
    text: (id, text) => ipcRenderer.send("api-server:text", id, text),
    model: (id, model) => ipcRenderer.send("api-server:model", id, model),
    done: (id, result) => ipcRenderer.send("api-server:done", id, result),
    failed: (id, message) => ipcRenderer.send("api-server:failed", id, message),
  },

  metrics: {
    record: (row) => ipcRenderer.invoke("metrics:record", row),
    list: (since) => ipcRenderer.invoke("metrics:list", since),
    clear: () => ipcRenderer.invoke("metrics:clear"),
  },

  git: {
    status: (workspaceId) => ipcRenderer.invoke("git:status", workspaceId),
    diff: (workspaceId, path, staged) =>
      ipcRenderer.invoke("git:diff", workspaceId, path, staged),
  },

  skills: {
    list: (workspaceId) => ipcRenderer.invoke("skills:list", workspaceId),
    read: (workspaceId, id, options) => ipcRenderer.invoke("skills:read", workspaceId, id, options),
    setEnabled: (id, enabled) => ipcRenderer.invoke("skills:set-enabled", id, enabled),
    openFolder: () => ipcRenderer.invoke("skills:open"),
  },

  workspaces: {
    list: () => ipcRenderer.invoke("workspace:list"),
    save: (workspace) => ipcRenderer.invoke("workspace:save", workspace),
    remove: (id) => ipcRenderer.invoke("workspace:delete", id),
    pickFolder: () => ipcRenderer.invoke("workspace:pick-folder"),
  },

  library: {
    list: (workspaceId) => ipcRenderer.invoke("library:list", workspaceId),
    stats: () => ipcRenderer.invoke("library:stats"),
    pickFolder: () => ipcRenderer.invoke("library:pick-folder"),
    index: (path, model, workspaceId) =>
      ipcRenderer.invoke("library:index", path, model, workspaceId),
    remove: (id) => ipcRenderer.invoke("library:remove", id),
    clear: () => ipcRenderer.invoke("library:clear"),
    search: (query, limit, model, options) =>
      ipcRenderer.invoke("library:search", query, limit, model, options),
    onProgress: (callback) => subscribe("library-progress", callback),
  },

  commands: {
    run: (workspaceId, runId, command, options) =>
      ipcRenderer.invoke("commands:run", workspaceId, runId, command, options),
    cancel: (runId) => ipcRenderer.invoke("commands:cancel", runId),
  },

  runner: {
    probe: () => ipcRenderer.invoke("runner:probe"),
    run: (language, source, timeoutMs) =>
      ipcRenderer.invoke("run-code", language, source, timeoutMs),
  },

  updater: {
    state: () => ipcRenderer.invoke("updater:state"),
    configure: (options) => ipcRenderer.invoke("updater:configure", options),
    check: (options) => ipcRenderer.invoke("updater:check", options),
    download: () => ipcRenderer.invoke("updater:download"),
    install: () => ipcRenderer.invoke("updater:install"),
    onState: (callback) => subscribe("updater-state", callback),
  },

  browserBar: {
    action: (name, value) =>
      ipcRenderer.invoke("browser-bar-action", name, value),
    setMenuOpen: (open) => ipcRenderer.invoke("browser-bar-menu", open),
    setAdblock: (enabled) =>
      ipcRenderer.invoke("browser-bar-set-adblock", enabled),
    onState: (callback) => subscribe("browser-bar-state", callback),
  },

  mcp: {
    catalogue: () => ipcRenderer.invoke("mcp:catalogue"),
    config: () => ipcRenderer.invoke("mcp:config"),
    save: (id, entry) => ipcRenderer.invoke("mcp:save", id, entry),
    forget: (id) => ipcRenderer.invoke("mcp:forget", id),
    start: (id) => ipcRenderer.invoke("mcp:start", id),
    stop: (id) => ipcRenderer.invoke("mcp:stop", id),
    running: () => ipcRenderer.invoke("mcp:running"),
    startEnabled: () => ipcRenderer.invoke("mcp:start-enabled"),
    enabled: () => ipcRenderer.invoke("mcp:enabled"),
    setEnabled: (id, enabled) => ipcRenderer.invoke("mcp:set-enabled", id, enabled),
    search: (query) => ipcRenderer.invoke("registry:search", query),
    signIn: (id) => ipcRenderer.invoke("mcp:sign-in", id),
    signOut: (id) => ipcRenderer.invoke("mcp:sign-out", id),
    call: (serverId, toolName, args) =>
      ipcRenderer.invoke("mcp:call", serverId, toolName, args),
    onState: (callback) => subscribe("mcp-state", callback),
  },

  widgets: {
    stage: (html) => ipcRenderer.invoke("widget:stage", html),
    release: (token) => ipcRenderer.invoke("widget:release", token),
  },

  appInfo: () => ipcRenderer.invoke("app:version"),
  openLogs: () => ipcRenderer.invoke("logs:open"),
  readLogs: (target, bytes) => ipcRenderer.invoke("logs:tail", target, bytes),
  logEntry: (entry) => ipcRenderer.send("logs:write", entry),
  logBatch: (entries) => ipcRenderer.send("logs:batch", entries),

  onDownloadProgress: (callback) => subscribe("download-progress", callback),
  onBootModel: (callback) => subscribe("boot-model", callback),
  bootFinished: (model) => ipcRenderer.send("boot-finished", model),
  quitApp: () => ipcRenderer.send("quit-app"),
  onBeforeQuit: (handler) => {
    beforeQuit.add(handler);
    return () => {
      beforeQuit.delete(handler);
    };
  },
});
