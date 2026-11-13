/** The renderer's whole native API, built on any transport that matches `IpcLike`. */

/** The four calls the API needs. Listeners get `(event, value)`. */
export interface IpcLike {
  // The channel decides the reply type, and the declared API types it at each call site.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invoke(channel: string, ...args: unknown[]): Promise<any>;
  send(channel: string, ...args: unknown[]): void;
  on(channel: string, listener: (event: unknown, value: unknown) => void): void;
  removeListener(channel: string, listener: (event: unknown, value: unknown) => void): void;
}

/** Several parts of the app can share a channel, so the disposer removes only this listener and
 * neither can silence the other. A channel past 20 listeners is the usual sign of an effect missing
 * its cleanup, so it logs once. */
const MAX_LISTENERS_PER_CHANNEL = 20;

export function createDraggyApi(ipc: IpcLike): NonNullable<Window["draggy"]> {
  const listenerCounts = new Map<string, number>();
  const warnedChannels = new Set<string>();
  const subscribe = (channel: string, callback: (value: never) => void) => {
    const listener = (_event: unknown, value: unknown) => callback(value as never);
    ipc.on(channel, listener);
    const count = (listenerCounts.get(channel) ?? 0) + 1;
    listenerCounts.set(channel, count);
    if (count > MAX_LISTENERS_PER_CHANNEL && !warnedChannels.has(channel)) {
      warnedChannels.add(channel);
      ipc.send("logs:write", {
        level: "WARN",
        context: "preload",
        message: "listener leak suspected",
        data: { channel, listeners: count },
      });
    }
    let removed = false;
    return () => {
      ipc.removeListener(channel, listener);
      if (!removed) {
        removed = true;
        listenerCounts.set(channel, Math.max(0, (listenerCounts.get(channel) ?? 1) - 1));
      }
    };
  };

  /** What the window runs before Draggy quits. It answers with none registered too, so a quit from
   * the startup screen does not sit out the timeout. */
  const beforeQuit = new Set<() => unknown>();
  ipc.on("app:flush-saves", async () => {
    await Promise.allSettled([...beforeQuit].map(async (handler) => handler()));
    ipc.send("app:saves-flushed");
  });

  /** The model the splash booted. It can land before React subscribes, and a page waiting for it stayed blank. */
  let bootModel: string | null = null;
  ipc.on("boot-model", (_event, model) => {
    bootModel = typeof model === "string" ? model : null;
  });

  return {
    getSystemSpecs: () => ipc.invoke("get-system-specs"),
    colibri: {
      status: () => ipc.invoke("colibri:status"),
      install: () => ipc.invoke("colibri:install"),
      rollback: () => ipc.invoke("colibri:rollback"),
      health: () => ipc.invoke("colibri:health"),
      start: (options) => ipc.invoke("colibri:start", options),
      stop: () => ipc.invoke("colibri:stop"),
      onLoadPhase: (callback) => subscribe("colibri-load-phase", callback),
      onInstallProgress: (callback) => subscribe("colibri-install-progress", callback),
    },
    largeModel: {
      plan: (repo) => ipc.invoke("largemodel:plan", repo),
      download: (options) => ipc.invoke("largemodel:download", options),
      cancel: () => ipc.invoke("largemodel:cancel"),
      getMirrors: (modelId) => ipc.invoke("largemodel:mirrors-get", modelId),
      setMirrors: (modelId, paths) => ipc.invoke("largemodel:mirrors-set", modelId, paths),
      onProgress: (callback) => subscribe("largemodel-progress", callback),
    },
    notifyDone: (title, body) => ipc.invoke("notify:done", title, body),
    tier: {
      catalog: (contextTokens) => ipc.invoke("tier:catalog", contextTokens),
      record: (sample) => ipc.invoke("tier:record", sample),
      report: () => ipc.invoke("tier:report"),
    },
    hardware: {
      probe: () => ipc.invoke("hardware:probe"),
      benchmark: (volume, options) => ipc.invoke("hardware:benchmark", volume, options),
      cancelBenchmark: () => ipc.invoke("hardware:cancel-benchmark"),
      onBenchmarkProgress: (callback) => subscribe("hardware-benchmark-progress", callback),
    },
    checkInternet: () => ipc.invoke("check-internet"),
    checkDiskSpace: () => ipc.invoke("check-disk-space"),

    searchWeb: (query) => ipc.invoke("search-web", query),
    searchWebDetailed: (query) => ipc.invoke("search-web-detailed", query),
    searchSource: (query, source) => ipc.invoke("search-source", query, source),
    setSearchConfig: (config) => ipc.invoke("set-search-config", config),
    // Write-only, like a provider's key: the status says whether one is set and its last four.
    setBraveKey: (key) => ipc.invoke("search:set-brave-key", key),
    braveKeyStatus: () => ipc.invoke("search:brave-key-status"),
    setServiceKey: (id, key) => ipc.invoke("search:set-service-key", id, key),
    serviceKeyStatus: (id) => ipc.invoke("search:service-key-status", id),
    readUrl: (url, page) => ipc.invoke("get-page-content", url, page),

    browserNavigate: (url) => ipc.invoke("browser-navigate", url),
    browserGetElements: () => ipc.invoke("browser-get-elements"),
    browserClick: (target, options) => ipc.invoke("browser-click", target, options),
    browserSnapshot: (options) => ipc.invoke("browser-snapshot", options),
    browserScreenshot: (options) => ipc.invoke("browser-screenshot", options),
    browserType: (target, text, options) => ipc.invoke("browser-type", target, text, options),
    browserPressKey: (key, options) => ipc.invoke("browser-press-key", key, options),
    browserHover: (target) => ipc.invoke("browser-hover", target),
    browserDrag: (from, to) => ipc.invoke("browser-drag", from, to),
    browserScroll: (options) => ipc.invoke("browser-scroll", options),
    browserSelectOption: (ref, choice) => ipc.invoke("browser-select-option", ref, choice),
    browserWait: (options) => ipc.invoke("browser-wait", options),
    browserHistory: (action) => ipc.invoke("browser-history", action),
    browserTabs: (action, options) => ipc.invoke("browser-tabs", action, options),
    browserDialog: (action, text) => ipc.invoke("browser-dialog", action, text),
    browserTrace: (kind, options) => ipc.invoke("browser-trace", kind, options),
    browserGetText: (options) => ipc.invoke("browser-get-text", options),
    browserClose: () => ipc.invoke("browser-close"),

    createFile: (filename, content, chatId) => ipc.invoke("create-file", filename, content, chatId),
    openFile: (filepath) => ipc.invoke("open-file", filepath),
    openCreatedFiles: () => ipc.invoke("open-created-files"),
    listCreatedFiles: () => ipc.invoke("list-created-files"),
    readCreatedFile: (filepath) => ipc.invoke("read-created-file", filepath),
    revealCreatedFile: (filepath) => ipc.invoke("reveal-created-file", filepath),
    deleteCreatedFile: (filepath) => ipc.invoke("delete-created-file", filepath),
    readDocument: (filename, data) => ipc.invoke("read-document", filename, data),

    searchModels: (query) => ipc.invoke("search-models", query),
    modelSize: (name, tag) => ipc.invoke("model-size", name, tag),
    resolveModelUrl: (reference, options) => ipc.invoke("resolve-model-url", reference, options),

    db: {
      loadChats: () => ipc.invoke("db:load-chats"),
      saveChat: (session) => ipc.invoke("db:save-chat", session),
      deleteChat: (id) => ipc.invoke("db:delete-chat", id),
      clearChats: () => ipc.invoke("db:clear-chats"),
      searchChats: (query) => ipc.invoke("db:search-chats", query),
      get: (key) => ipc.invoke("db:get", key),
      set: (key, value) => ipc.invoke("db:set", key, value),
      importSessions: (sessions) => ipc.invoke("db:import", sessions),
      stats: () => ipc.invoke("db:stats"),
    },

    files: {
      list: (workspaceId, path) => ipc.invoke("fs:list", workspaceId, path),
      read: (workspaceId, path) => ipc.invoke("fs:read", workspaceId, path),
      write: (workspaceId, path, contents, chatId) =>
        ipc.invoke("fs:write", workspaceId, path, contents, chatId),
      edit: (workspaceId, path, find, replace, expected, chatId) =>
        ipc.invoke("fs:edit", workspaceId, path, find, replace, expected, chatId),
      move: (workspaceId, from, to, chatId) =>
        ipc.invoke("fs:move", workspaceId, from, to, chatId),
      remove: (workspaceId, path, chatId) =>
        ipc.invoke("fs:delete", workspaceId, path, chatId),
      search: (workspaceId, query) =>
        ipc.invoke("fs:search", workspaceId, query),
      open: (workspaceId, path) => ipc.invoke("fs:open", workspaceId, path),
      reveal: (workspaceId, path) => ipc.invoke("fs:reveal", workspaceId, path),
      checkpoints: (workspaceId) =>
        ipc.invoke("checkpoint:list", workspaceId),
      revert: (id) => ipc.invoke("checkpoint:revert", id),
      onChanged: (callback) => subscribe("file-changed", callback),
    },

    apiServer: {
      status: () => ipc.invoke("api-server:status"),
      configure: (config) => ipc.invoke("api-server:configure", config),
      regenerateKey: () => ipc.invoke("api-server:regenerate-key"),
      ready: () => ipc.send("api-server:ready"),
      onRequest: (callback) => subscribe("api-server:request", callback),
      onAbort: (callback) => subscribe("api-server:abort", callback),
      text: (id, text) => ipc.send("api-server:text", id, text),
      model: (id, model) => ipc.send("api-server:model", id, model),
      done: (id, result) => ipc.send("api-server:done", id, result),
      failed: (id, message) => ipc.send("api-server:failed", id, message),
    },

    metrics: {
      record: (row) => ipc.invoke("metrics:record", row),
      list: (since) => ipc.invoke("metrics:list", since),
      clear: () => ipc.invoke("metrics:clear"),
    },

    pricing: {
      table: () => ipc.invoke("pricing:table"),
      configure: (options) => ipc.invoke("pricing:configure", options),
      refresh: () => ipc.invoke("pricing:refresh"),
      status: () => ipc.invoke("pricing:status"),
      rates: () => ipc.invoke("pricing:rates"),
      onUpdated: (callback) => subscribe("pricing-updated", callback),
    },

    git: {
      status: (workspaceId) => ipc.invoke("git:status", workspaceId),
      diff: (workspaceId, path, staged, untracked, ignoreWhitespace) =>
        ipc.invoke("git:diff", workspaceId, path, staged, untracked, ignoreWhitespace),
      log: (workspaceId, limit, all) => ipc.invoke("git:log", workspaceId, limit, all),
      show: (workspaceId, hash, ignoreWhitespace) => ipc.invoke("git:show", workspaceId, hash, ignoreWhitespace),
      branches: (workspaceId) => ipc.invoke("git:branches", workspaceId),
      stage: (workspaceId, paths) => ipc.invoke("git:stage", workspaceId, paths),
      unstage: (workspaceId, paths) => ipc.invoke("git:unstage", workspaceId, paths),
      commit: (workspaceId, message) => ipc.invoke("git:commit", workspaceId, message),
      checkout: (workspaceId, branch) => ipc.invoke("git:checkout", workspaceId, branch),
    },

    skills: {
      list: (workspaceId) => ipc.invoke("skills:list", workspaceId),
      read: (workspaceId, id, options) => ipc.invoke("skills:read", workspaceId, id, options),
      setEnabled: (id, enabled) => ipc.invoke("skills:set-enabled", id, enabled),
      openFolder: () => ipc.invoke("skills:open"),
    },

    workspaces: {
      list: () => ipc.invoke("workspace:list"),
      save: (workspace) => ipc.invoke("workspace:save", workspace),
      remove: (id) => ipc.invoke("workspace:delete", id),
      pickFolder: () => ipc.invoke("workspace:pick-folder"),
    },

    library: {
      list: (workspaceId) => ipc.invoke("library:list", workspaceId),
      stats: () => ipc.invoke("library:stats"),
      pickFolder: () => ipc.invoke("library:pick-folder"),
      index: (path, model, workspaceId) =>
        ipc.invoke("library:index", path, model, workspaceId),
      remove: (id) => ipc.invoke("library:remove", id),
      clear: () => ipc.invoke("library:clear"),
      search: (query, limit, model, options) =>
        ipc.invoke("library:search", query, limit, model, options),
      onProgress: (callback) => subscribe("library-progress", callback),
    },
    research: {
      list: (workspaceId) => ipc.invoke("research:list", workspaceId),
      get: (id) => ipc.invoke("research:get", id),
      save: (run) => ipc.invoke("research:save", run),
      remove: (id) => ipc.invoke("research:remove", id),
      search: (query, options) => ipc.invoke("research:search", query, options),
    },

    chats: {
      folder: (chatId, open) => ipc.invoke("chats:folder", chatId, open === true),
    },
    commands: {
      run: (workspaceId, runId, command, options) =>
        ipc.invoke("commands:run", workspaceId, runId, command, options),
      cancel: (runId) => ipc.invoke("commands:cancel", runId),
      detach: (runId) => ipc.invoke("commands:detach", runId),
      resetState: (chatId) => ipc.invoke("commands:resetState", chatId),
      onOutput: (callback) => subscribe("commands:output", callback),
    },

    tasks: {
      list: (chatId) => ipc.invoke("tasks:list", chatId),
      output: (chatId, id, options) => ipc.invoke("tasks:output", chatId, id, options),
      wait: (chatId, id, options) => ipc.invoke("tasks:wait", chatId, id, options),
      abortWait: (waitId) => ipc.invoke("tasks:abortWait", waitId),
      stop: (chatId, id) => ipc.invoke("tasks:stop", chatId, id),
      write: (chatId, id, data) => ipc.invoke("tasks:write", chatId, id, data),
      input: (chatId, id, data) => ipc.send("tasks:input", chatId, id, data),
      resize: (uid, cols, rows) => ipc.invoke("tasks:resize", uid, cols, rows),
      snapshot: (uid) => ipc.invoke("tasks:snapshot", uid),
      takeInbox: (chatId) => ipc.invoke("tasks:takeInbox", chatId),
      hasRunning: (chatId) => ipc.invoke("tasks:hasRunning", chatId),
      forget: (chatId) => ipc.invoke("tasks:forget", chatId),
      onEvent: (callback) => subscribe("tasks:event", callback),
    },

    shell: {
      list: () => ipc.invoke("shell:list"),
      open: (workspaceId, options) => ipc.invoke("shell:open", workspaceId, options),
      write: (id, data) => ipc.send("shell:write", id, data),
      resize: (id, cols, rows) => ipc.invoke("shell:resize", id, cols, rows),
      close: (id) => ipc.invoke("shell:close", id),
      onData: (callback) => subscribe("shell:data", callback),
      onExit: (callback) => subscribe("shell:exit", callback),
    },

    runner: {
      probe: () => ipc.invoke("runner:probe"),
      run: (language, source, timeoutMs) =>
        ipc.invoke("run-code", language, source, timeoutMs),
    },

    updater: {
      state: () => ipc.invoke("updater:state"),
      install: () => ipc.invoke("updater:install"),
      onState: (callback) => subscribe("updater-state", callback),
    },

    browserBar: {
      action: (name, value) =>
        ipc.invoke("browser-bar-action", name, value),
      setMenuOpen: (open) => ipc.invoke("browser-bar-menu", open),
      setAdblock: (enabled) =>
        ipc.invoke("browser-bar-set-adblock", enabled),
      onState: (callback) => subscribe("browser-bar-state", callback),
    },

    // The Browser pane's page is a native view main lays over the pane. The renderer only says where
    // the pane is and whether it shows; the rectangle goes across as four numbers and nothing else.
    browserPane: {
      setBounds: (rect) =>
        ipc.invoke("browser-pane:bounds", {
          x: Number(rect?.x),
          y: Number(rect?.y),
          width: Number(rect?.width),
          height: Number(rect?.height),
        }),
      setVisible: (visible) => ipc.invoke("browser-pane:visible", Boolean(visible)),
      onOpen: (callback) => subscribe("browser-pane-open", callback),
    },

    // The agent drives the Browser pane. The renderer hears which step it is on and can take the pane back.
    browserAgent: {
      stop: () => ipc.invoke("browser-agent:stop"),
      release: () => ipc.invoke("browser-agent:release"),
      onState: (callback) => subscribe("browser-agent-state", callback),
      onConsent: (callback) => subscribe("browser-consent", callback),
      answerConsent: (id, choice) => ipc.invoke("browser-consent:answer", String(id), String(choice)),
      trustedSites: () => ipc.invoke("browser-grants:list"),
      revokeSite: (origin) => ipc.invoke("browser-grants:revoke", String(origin)),
    },

    mcp: {
      catalogue: () => ipc.invoke("mcp:catalogue"),
      config: () => ipc.invoke("mcp:config"),
      save: (id, entry) => ipc.invoke("mcp:save", id, entry),
      forget: (id) => ipc.invoke("mcp:forget", id),
      start: (id) => ipc.invoke("mcp:start", id),
      stop: (id) => ipc.invoke("mcp:stop", id),
      running: () => ipc.invoke("mcp:running"),
      startEnabled: () => ipc.invoke("mcp:start-enabled"),
      enabled: () => ipc.invoke("mcp:enabled"),
      setEnabled: (id, enabled) => ipc.invoke("mcp:set-enabled", id, enabled),
      search: (query) => ipc.invoke("registry:search", query),
      signIn: (id) => ipc.invoke("mcp:sign-in", id),
      signOut: (id) => ipc.invoke("mcp:sign-out", id),
      call: (serverId, toolName, args, correlationId) =>
        ipc.invoke("mcp:call", serverId, toolName, args, correlationId),
      onState: (callback) => subscribe("mcp-state", callback),
    },

    widgets: {
      stage: (html) => ipc.invoke("widget:stage", html),
      release: (token) => ipc.invoke("widget:release", token),
    },

    gguf: {
      status: () => ipc.invoke("gguf:status"),
      setupEngine: () => ipc.invoke("gguf:setup-engine"),
      start: (options) => ipc.invoke("gguf:start", options),
      stop: () => ipc.invoke("gguf:stop"),
      listModels: () => ipc.invoke("gguf:models"),
      deleteModel: (filename) => ipc.invoke("gguf:delete", filename),
      downloadModel: (options) => ipc.invoke("gguf:download", options),
      cancelDownload: (filename) => ipc.invoke("gguf:cancel-download", filename),
      onProgress: (callback) => subscribe("gguf:progress", callback),
      onStage: (callback) => subscribe("gguf:stage", callback),
    },

    sd: {
      status: () => ipc.invoke("sd:status"),
      configure: (options) => ipc.invoke("sd:configure", options),
      setupEngine: () => ipc.invoke("sd:setup-engine"),
      downloadRepo: (reference) => ipc.invoke("sd:download-repo", reference),
      cancelDownload: (id) => ipc.invoke("sd:cancel-download", id),
      deleteModel: (id) => ipc.invoke("sd:delete-model", id),
      generate: (request) => ipc.invoke("sd:generate", request),
      cancel: (requestId) => ipc.invoke("sd:cancel", requestId),
      stop: () => ipc.invoke("sd:stop"),
      onProgress: (callback) => subscribe("sd:progress", callback),
    },

    onboarding: {
      state: () => ipc.invoke("onboarding:state"),
      start: () => ipc.invoke("onboarding:start"),
      complete: (path) => ipc.invoke("onboarding:complete", path),
      reset: () => ipc.invoke("onboarding:reset"),
    },

    // A key crosses once, into main's keystore: nothing here can read one back.
    tts: {
      providers: () => ipc.invoke("tts:providers"),
      grantConsent: (provider) => ipc.invoke("tts:consent-grant", provider),
      revokeConsent: (provider) => ipc.invoke("tts:consent-revoke", provider),
      speak: (turnId, request) => ipc.invoke("tts:speak", turnId, request),
      cancel: (turnId) => ipc.invoke("tts:cancel", turnId),
      onFrames: (callback) => subscribe("tts:frames", callback),
    },
    providers: {
      catalog: () => ipc.invoke("providers:catalog"),
      list: () => ipc.invoke("providers:list"),
      add: (input) => ipc.invoke("providers:add", input),
      update: (id, patch) => ipc.invoke("providers:update", id, patch),
      remove: (id) => ipc.invoke("providers:remove", id),
      setKey: (id, apiKey) => ipc.invoke("providers:set-key", id, apiKey),
      test: (id) => ipc.invoke("providers:test", id),
      models: (id, options) => ipc.invoke("providers:models", id, options),
      scan: () => ipc.invoke("providers:scan"),
      accountSignIn: (id) => ipc.invoke("providers:account-sign-in", id),
      accountCancel: (id) => ipc.invoke("providers:account-cancel", id),
      accountSubmitCode: (id, code) => ipc.invoke("providers:account-submit-code", id, code),
      accountSignOut: (id) => ipc.invoke("providers:account-sign-out", id),
      accountStatus: (id) => ipc.invoke("providers:account-status", id),
      onAccountProgress: (callback) => subscribe("providers:account-progress", callback),
      onModelsChanged: (callback) => subscribe("providers:models-changed", callback),
    },

    appInfo: () => ipc.invoke("app:version"),
    openLogs: () => ipc.invoke("logs:open"),
    readLogs: (target, bytes) => ipc.invoke("logs:tail", target, bytes),
    getLogLevel: () => ipc.invoke("logs:get-level"),
    setLogLevel: (options) => ipc.invoke("logs:set-level", options),
    diagnostics: {
      preview: (choices) => ipc.invoke("diagnostics:preview", choices),
      export: (choices) => ipc.invoke("diagnostics:export", choices),
      crashNotice: () => ipc.invoke("diagnostics:crash-notice"),
    },
    exportChat: (request) => ipc.invoke("chat:export", request),
    logEntry: (entry) => ipc.send("logs:write", entry),
    logBatch: (entries) => ipc.send("logs:batch", entries),

    onDownloadProgress: (callback) => subscribe("download-progress", callback),
    onBootModel: (callback) => {
      if (bootModel) callback(bootModel);
      return subscribe("boot-model", callback);
    },
    onBootOpen: (callback) => subscribe("boot-open", callback),
    // Only the one page the splash can hand over to; anything else is dropped here.
    bootFinished: (model, open) => ipc.send("boot-finished", model, open === "providers" ? "providers" : undefined),
    quitApp: () => ipc.send("quit-app"),
    onBeforeQuit: (handler) => {
      beforeQuit.add(handler);
      return () => {
        beforeQuit.delete(handler);
      };
    },
  };
}
