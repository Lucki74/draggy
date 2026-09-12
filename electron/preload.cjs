const { contextBridge, ipcRenderer } = require("electron");

/**
 * Two parts of the app may want the same channel: Settings shows an update's
 * progress while the window waits for one to finish. Returns a disposer that
 * removes this listener alone, so neither can silence the other.
 */
const subscribe = (channel, callback) => {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

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
  },

  skills: {
    list: (workspaceId) => ipcRenderer.invoke("skills:list", workspaceId),
    read: (workspaceId, id) => ipcRenderer.invoke("skills:read", workspaceId, id),
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
    startEnabled: (workspaceId) =>
      ipcRenderer.invoke("mcp:start-enabled", workspaceId),
    enabled: (workspaceId) => ipcRenderer.invoke("mcp:enabled", workspaceId),
    setEnabled: (workspaceId, id, enabled) =>
      ipcRenderer.invoke("mcp:set-enabled", workspaceId, id, enabled),
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
  readLogs: () => ipcRenderer.invoke("logs:tail"),

  onDownloadProgress: (callback) => subscribe("download-progress", callback),
  onBootModel: (callback) => subscribe("boot-model", callback),
  bootFinished: (model) => ipcRenderer.send("boot-finished", model),
  quitApp: () => ipcRenderer.send("quit-app"),
});
