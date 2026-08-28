const { contextBridge, ipcRenderer } = require("electron");

const subscribe = (channel, callback) => {
  ipcRenderer.removeAllListeners(channel);
  ipcRenderer.on(channel, (_event, value) => callback(value));
};

contextBridge.exposeInMainWorld("electronAPI", {
  getSystemSpecs: () => ipcRenderer.invoke("get-system-specs"),
  checkOllama: () => ipcRenderer.invoke("check-ollama"),
  startOllama: () => ipcRenderer.invoke("start-ollama"),
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

  library: {
    list: () => ipcRenderer.invoke("library:list"),
    stats: () => ipcRenderer.invoke("library:stats"),
    pickFolder: () => ipcRenderer.invoke("library:pick-folder"),
    index: (path, model) => ipcRenderer.invoke("library:index", path, model),
    remove: (id) => ipcRenderer.invoke("library:remove", id),
    clear: () => ipcRenderer.invoke("library:clear"),
    search: (query, limit, model) =>
      ipcRenderer.invoke("library:search", query, limit, model),
    onProgress: (callback) => subscribe("library-progress", callback),
    offProgress: () => ipcRenderer.removeAllListeners("library-progress"),
  },

  runner: {
    probe: () => ipcRenderer.invoke("runner:probe"),
    run: (language, source, timeoutMs) =>
      ipcRenderer.invoke("run-code", language, source, timeoutMs),
  },

  updater: {
    state: () => ipcRenderer.invoke("updater:state"),
    check: (options) => ipcRenderer.invoke("updater:check", options),
    download: () => ipcRenderer.invoke("updater:download"),
    install: () => ipcRenderer.invoke("updater:install"),
    onState: (callback) => subscribe("updater-state", callback),
    offState: () => ipcRenderer.removeAllListeners("updater-state"),
  },

  appInfo: () => ipcRenderer.invoke("app:version"),
  openLogs: () => ipcRenderer.invoke("logs:open"),
  readLogs: () => ipcRenderer.invoke("logs:tail"),

  onDownloadProgress: (callback) => subscribe("download-progress", callback),
  offDownloadProgress: () => ipcRenderer.removeAllListeners("download-progress"),
  onBootModel: (callback) => subscribe("boot-model", callback),
  bootFinished: (model) => ipcRenderer.send("boot-finished", model),
  quitApp: () => ipcRenderer.send("quit-app"),
});
