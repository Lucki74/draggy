/** Drops one listener from a main-process channel, leaving the others alone. */
export type Unsubscribe = () => void;

export interface SystemSpecs {
  cpu: string;
  ram: number;
  vram: number;
  unifiedMemory?: boolean;
  platform?: string;
  arch?: string;
}

export interface Attachment {
  name: string;
  type: string;
  content: string;
}

export interface LibraryModel {
  name: string;
  description: string;
  capabilities: string[];
  sizes: string[];
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface BrowserElement {
  index: number;
  type: "button" | "link" | "input" | "select";
  text: string;
  href?: string;
  value?: string;
  x: number;
  y: number;
}

export interface DownloadProgressEvent {
  percent: number;
  completed: number;
  total: number;
}

export interface LibraryHit {
  id: number;
  name: string;
  path: string;
  heading: string;
  text: string;
  score: number;
}

export interface LibrarySource {
  id: number;
  path: string;
  addedAt: number;
  files: number;
  chunks: number;
}

export interface LibraryStats {
  sources: number;
  files: number;
  chunks: number;
  embedModel: string;
  ceiling: number;
}

export interface LibraryProgress {
  phase: "indexing" | "done";
  current: number;
  total: number;
  file: string;
}

export interface IndexResult {
  success: boolean;
  error?: string;
  indexed?: number;
  skipped?: number;
  failed?: number;
  chunks?: number;
  files?: number;
}

export interface RunCodeResult {
  success: boolean;
  error?: string;
  language?: string;
  exitCode?: number | null;
  signal?: string | null;
  timedOut?: boolean;
  stdout?: string;
  stderr?: string;
  truncated?: boolean;
  durationMs?: number;
  files?: string[];
}

export interface RunnerProbe {
  success: boolean;
  python: boolean;
  pythonCommand: string | null;
  javascript: boolean;
  platform: string;
}

export interface UpdaterState {
  status:
    | "idle"
    | "disabled"
    | "checking"
    | "available"
    | "current"
    | "downloading"
    | "ready"
    | "installing"
    | "error";
  version: string | null;
  percent: number;
  notes: string | null;
  error: string | null;
}

export interface BrowserBarState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  adblock: boolean;
}

export interface AppInfo {
  version: string;
  electron: string;
  node: string;
  chrome: string;
  platform: string;
  arch: string;
  packaged: boolean;
}

export interface StorageStats {
  chats: number;
  messages: number;
  attachments: number;
  attachmentBytes: number;
}

export interface ChatSearchHit {
  chatId: string;
  messageId: string;
  title: string;
  excerpt: string;
}

/** A file the model wrote, as it exists on disk right now. */
export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modified: number;
}

export interface FileWriteResult {
  success: boolean;
  path?: string;
  /** What to pass to a revert, if the user wants the change undone. */
  checkpointId?: number;
  created?: boolean;
  error?: string;
}

export interface FileSearchHit {
  path: string;
  name: string;
  /** Set when the search was for text rather than a file name. */
  line?: number;
  text?: string;
}

/** One change Draggy made to a file, and what it looked like beforehand. */
export interface Checkpoint {
  id: number;
  workspaceId: string;
  chatId: string | null;
  path: string;
  action: "write" | "delete" | "move";
  detail: string | null;
  beforeHash: string | null;
  afterHash: string | null;
  createdAt: number;
}

export interface CreatedFile {
  name: string;
  path: string;
  size: number;
  /** Milliseconds since the epoch. */
  modified: number;
  extension: string;
}

export interface SearchStepLibraryHit {
  name: string;
  path: string;
  score: number;
}

export interface SearchStep {
  id: string;
  type:
    | "thinking"
    /** Ollama loading the weights, gone again at the first token. */
    | "loading"
    /**
     * Prose written between two tool calls. In the step list so it stays where
     * it was written, rather than collected up after the tool activity.
     */
    | "text"
    | "searching"
    | "results"
    | "opening"
    | "reading"
    | "error"
    | "navigating"
    | "clicking"
    | "typing"
    | "loaded"
    | "scanned"
    | "create_file"
    /** A change to a file of the user's, which can be undone. */
    | "edit_file"
    | "library"
    | "run_code"
    /** A tool call waiting on the user, with the buttons to answer it. */
    | "approval"
    /** The model writing down what it is going to do. */
    | "plan"
    /** The model reaching for something the user wrote down for it. */
    | "skill"
    /** A tool borrowed from an MCP server, so the timeline shows those too. */
    | "extension";
  content: string;
  thoughtTime?: number;
  isComplete?: boolean;
  results?: SearchResult[];
  filepath?: string;
  filename?: string;
  fileContent?: string;
  libraryHits?: SearchStepLibraryHit[];
  language?: string;
  stdout?: string;
  stderr?: string;
  /** On an "edit_file" step: what to hand a revert, and what changed. */
  checkpointId?: number;
  before?: string;
  after?: string;
  /** On an "approval" step: the call the user is being asked about. */
  approval?: {
    id: string;
    tool: string;
    target?: string | null;
    reason: string;
  };
  /** What the user answered. Absent while the card is still waiting. */
  answer?: ApprovalAnswer;
}

/**
 * How far an approval goes: this call only, the rest of this task, or every
 * time in this workspace. "no" is a refusal of the call in front of the user.
 */
export type ApprovalAnswer = "once" | "task" | "workspace" | "no";

export interface TurnMetrics {
  promptTokens: number;
  responseTokens: number;
  promptMs: number;
  responseMs: number;
  loadMs: number;
  totalMs: number;
  tokensPerSecond: number;
  timeToFirstTokenMs: number | null;
  contextWindow: number;
  model: string;
  gpuPercent: number | null;
}

export interface MessageVersion {
  content: string;
  thinkingContent?: string | null;
  textContent?: string;
  thoughtTime?: number;
  steps?: SearchStep[];
  metrics?: TurnMetrics | null;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  thinkingContent?: string | null;
  textContent?: string;
  attachments?: Attachment[];
  thoughtTime?: number;
  steps?: SearchStep[];
  versions?: MessageVersion[];
  currentVersionIndex?: number;
  metrics?: TurnMetrics | null;
}

/**
 * The older conversation, folded into notes. `throughIndex` is exclusive, and
 * this describes what goes on the wire, not what the conversation is.
 */
export interface CompactionState {
  throughIndex: number;
  summary: string;
  updatedAt: number;
}


/** One field a server needs before it will run. */
export interface McpRequirement {
  key: string;
  label: string;
  secret?: boolean;
  required?: boolean;
  placeholder?: string;
  multiple?: boolean;
}

export interface McpCatalogueEntry {
  id: string;
  name: string;
  description: string;
  package: string;
  /** The package's own page on npm, which renders its README. */
  docs: string;
  /** The service the server talks to. Absent for a purely local one. */
  site?: string;
  args: string[];
  arguments?: McpRequirement[];
  env: McpRequirement[];
  /** Shown next to the switch when a server can do something irreversible. */
  caution?: string;
}

/** A skill on disk, as it appears in the prompt: no body, just the offer. */
export interface InstalledSkill {
  id: string;
  name: string;
  description: string;
  path: string;
  source: "user" | "project";
}

export interface LoadedSkill extends InstalledSkill {
  body: string;
  /** Anything else in the skill's folder: templates, scripts, examples. */
  files: string[];
}

/** A server found in the registry rather than one Draggy ships. */
export interface RegistryEntry {
  id: string;
  name: string;
  description: string;
  source: "registry";
  docs?: string;
  package?: string;
  url?: string;
  transport?: "http";
  remote?: boolean;
}

export interface McpServerConfig {
  enabled: boolean;
  env: Record<string, string>;
  arguments: Record<string, string | string[]>;
  /** Set when the server is somewhere else rather than a program on this machine. */
  url?: string;
  name?: string;
}

export interface McpToolDescription {
  name: string;
  qualifiedName: string;
  description: string;
  inputSchema: {
    type?: string;
    properties?: Record<
      string,
      { type?: string; description?: string; enum?: unknown[] }
    >;
    required?: string[];
  };
}

export interface McpServerState {
  id: string;
  status: string;
  error: string | null;
  tools: McpToolDescription[];
}

/**
 * How much a turn may do on its own. A workspace holds one of these, and every
 * tool call is measured against it.
 */
export type PermissionMode = "plan" | "ask" | "acceptEdits" | "auto";

export type WorkspaceKind = "chat" | "project";

/**
 * The settings a workspace may override. Everything else (the theme, the
 * voice, the update schedule) stays a property of the app, not of the work.
 */
export type WorkspaceOverrides = Partial<
  Pick<
    AppSettings,
    | "modelName"
    | "customInstructions"
    | "thinkingMode"
    | "webMode"
    | "codeExecution"
    | "libraryEnabled"
  >
>;

/** A tool call the user has already agreed to, kept with its workspace. */
export interface WorkspaceGrant {
  tool: string;
  target?: string;
}

export interface Workspace {
  id: string;
  /** Empty for the default workspace, which the interface names itself. */
  name: string;
  kind: WorkspaceKind;
  /** The folder a project is about. Null for an ordinary chat workspace. */
  rootPath: string | null;
  permissionMode: PermissionMode;
  settings: WorkspaceOverrides;
  /** What the user has allowed here for good, rather than for one task. */
  grants: WorkspaceGrant[];
  createdAt: number;
  updatedAt: number;
}

import type { PlanItem } from "./plan/plan";

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
  /** Which workspace it belongs to. Missing means the default one. */
  workspaceId?: string;
  /** What the model is working through, if it wrote a plan. */
  plan?: PlanItem[] | null;
  isGenerating: boolean;
  isOutOfContext?: boolean;
  compaction?: CompactionState | null;
}

export type SearchProvider =
  | "auto"
  | "duckduckgo"
  | "startpage"
  | "searxng"
  | "brave"
  | "brave-html";

export interface AppSettings {
  theme: "light" | "dark";
  fontSize: "sm" | "base" | "lg";
  language: string;
  modelName: string;
  customInstructions: string[];
  thinkingMode: "low" | "medium" | "high";
  webMode: "auto" | "on" | "off";
  voiceName: string;
  /**
   * Model that answers in Talk. Empty means automatic, which sizes a small
   * conversational model to the graphics card and downloads it on first use.
   */
  voiceModel: string;
  voiceEngine: "system" | "neural";
  neuralVoice: string;
  voiceRate: number;
  searchProvider: SearchProvider;
  searxngUrl: string;
  braveApiKey: string;
  codeExecution: boolean;
  libraryEnabled: boolean;
  embedModel: string;
  showMetrics: boolean;
  autoUpdate: boolean;
}

declare global {
  interface Window {
    electronAPI?: {
      getSystemSpecs: () => Promise<SystemSpecs>;
      checkOllama: () => Promise<boolean>;
      startOllama: () => Promise<boolean>;
      /** So what Draggy loaded is unloaded when it quits. */
      modelInUse: (name: string) => void;
      installOllama: () => Promise<boolean>;
      checkInternet: () => Promise<boolean>;
      checkDiskSpace: () => Promise<number>;

      searchWeb: (query: string) => Promise<SearchResult[]>;
      searchWebDetailed: (query: string) => Promise<{
        results: SearchResult[];
        provider: string | null;
        tried: string[];
        /**
         * "empty" means the web had nothing; "unavailable" means no provider
         * answered, which is temporary and says nothing about the subject.
         */
        status: "ok" | "empty" | "unavailable";
        cached?: boolean;
      }>;
      setSearchConfig: (config: {
        searchProvider: string;
        searxngUrl: string;
        braveApiKey: string;
      }) => Promise<{ success: boolean }>;
      readUrl: (url: string) => Promise<{
        title: string;
        text: string;
        /** Set when the page could not be read rather than had no content. */
        blocked?: "human-verification" | "refused";
        /** Why a refused address was refused, worded for the model. */
        reason?: string;
        url?: string;
      }>;

      browserNavigate: (url: string) => Promise<{
        success: boolean;
        title?: string;
        url?: string;
        /** Set when a bot check stopped the page, as `readUrl` reports it. */
        blocked?: "human-verification";
        /** Set when the address was outside what the tools may fetch. */
        refused?: boolean;
        error?: string;
      }>;
      browserGetElements: () => Promise<{
        success: boolean;
        elements: BrowserElement[];
        error?: string;
      }>;
      browserClick: (index: number) => Promise<{ success: boolean; title?: string; url?: string; error?: string }>;
      browserType: (index: number, text: string) => Promise<{ success: boolean; error?: string }>;
      browserPressKey: (key: string) => Promise<{ success: boolean; error?: string }>;
      browserGetText: () => Promise<{ success: boolean; title?: string; text?: string; url?: string; error?: string }>;
      browserClose: () => Promise<{ success: boolean }>;

      createFile: (filename: string, content: string) => Promise<{ success: boolean; filepath?: string; filename?: string; error?: string }>;
      openFile: (filepath: string) => Promise<string>;
      openCreatedFiles: () => Promise<string>;
      listCreatedFiles: () => Promise<{
        success: boolean;
        files: CreatedFile[];
        error?: string;
      }>;
      readCreatedFile: (filepath: string) => Promise<{
        success: boolean;
        text?: string;
        truncated?: boolean;
        binary?: boolean;
        error?: string;
      }>;
      revealCreatedFile: (
        filepath: string,
      ) => Promise<{ success: boolean; error?: string }>;
      deleteCreatedFile: (
        filepath: string,
      ) => Promise<{ success: boolean; error?: string }>;
      readDocument: (
        filename: string,
        data: Uint8Array,
      ) => Promise<{ success: boolean; text?: string; error?: string }>;

      searchModels: (query: string) => Promise<{
        success: boolean;
        models?: LibraryModel[];
        error?: string;
      }>;
      modelSize: (
        name: string,
        tag: string,
      ) => Promise<{ success: boolean; bytes?: number; error?: string }>;

      db: {
        loadChats: () => Promise<{ success: boolean; chats?: ChatSession[]; error?: string }>;
        saveChat: (session: unknown) => Promise<{ success: boolean; error?: string }>;
        deleteChat: (id: string) => Promise<{ success: boolean; error?: string }>;
        clearChats: () => Promise<{ success: boolean; error?: string }>;
        searchChats: (query: string) => Promise<{
          success: boolean;
          results?: ChatSearchHit[];
          error?: string;
        }>;
        get: (key: string) => Promise<{ success: boolean; value?: string | null }>;
        set: (key: string, value: string) => Promise<{ success: boolean }>;
        importSessions: (sessions: unknown[]) => Promise<{ success: boolean; imported?: number }>;
        stats: () => Promise<{ success: boolean; stats?: StorageStats }>;
      };

      files: {
        list: (
          workspaceId: string,
          path?: string,
        ) => Promise<{
          success: boolean;
          path?: string;
          entries?: DirectoryEntry[];
          truncated?: boolean;
          error?: string;
        }>;
        read: (
          workspaceId: string,
          path: string,
        ) => Promise<{
          success: boolean;
          path?: string;
          text?: string;
          bytes?: number;
          error?: string;
        }>;
        write: (
          workspaceId: string,
          path: string,
          contents: string,
          chatId?: string,
        ) => Promise<FileWriteResult>;
        edit: (
          workspaceId: string,
          path: string,
          find: string,
          replace: string,
          expected?: number,
          chatId?: string,
        ) => Promise<
          FileWriteResult & { replaced?: number; before?: string; after?: string }
        >;
        move: (
          workspaceId: string,
          from: string,
          to: string,
          chatId?: string,
        ) => Promise<FileWriteResult & { from?: string }>;
        remove: (
          workspaceId: string,
          path: string,
          chatId?: string,
        ) => Promise<FileWriteResult>;
        search: (
          workspaceId: string,
          query: { name?: string; text?: string; limit?: number },
        ) => Promise<{
          success: boolean;
          hits?: FileSearchHit[];
          truncated?: boolean;
          error?: string;
        }>;
        checkpoints: (workspaceId: string) => Promise<{
          success: boolean;
          checkpoints?: Checkpoint[];
        }>;
        revert: (
          id: number,
        ) => Promise<{ success: boolean; path?: string; error?: string }>;
      };

      skills: {
        list: (
          workspaceId: string,
        ) => Promise<{ success: boolean; skills?: InstalledSkill[] }>;
        read: (
          workspaceId: string,
          id: string,
        ) => Promise<{ success: boolean; skill?: LoadedSkill; error?: string }>;
        openFolder: () => Promise<string>;
      };

      workspaces: {
        list: () => Promise<{
          success: boolean;
          workspaces?: Workspace[];
          error?: string;
        }>;
        save: (workspace: Workspace) => Promise<{
          success: boolean;
          workspace?: Workspace;
          error?: string;
        }>;
        remove: (id: string) => Promise<{
          success: boolean;
          moved?: number;
          error?: string;
        }>;
        pickFolder: () => Promise<{
          success: boolean;
          path?: string;
          cancelled?: boolean;
        }>;
      };

      library: {
        list: () => Promise<{ success: boolean; sources?: LibrarySource[]; error?: string }>;
        stats: () => Promise<{ success: boolean; stats?: LibraryStats; error?: string }>;
        pickFolder: () => Promise<{ success: boolean; path?: string; cancelled?: boolean }>;
        index: (path: string, model: string) => Promise<IndexResult>;
        remove: (id: number) => Promise<{ success: boolean }>;
        clear: () => Promise<{ success: boolean }>;
        search: (
          query: string,
          limit?: number,
          model?: string,
          options?: { source?: string },
        ) => Promise<{
          success: boolean;
          results?: LibraryHit[];
          empty?: boolean;
          /** Set when a named folder matched no source, or matched several. */
          unknownSource?: boolean;
          /** The folders actually indexed, so the model can name a real one. */
          sources?: string[];
          error?: string;
        }>;
        onProgress: (callback: (progress: LibraryProgress) => void) => Unsubscribe;
      };

      runner: {
        probe: () => Promise<RunnerProbe>;
        run: (
          language: string,
          source: string,
          timeoutMs?: number,
        ) => Promise<RunCodeResult>;
      };

      updater: {
        state: () => Promise<UpdaterState>;
        /**
         * Turns background checking and downloading on or off. Sent whenever
         * the automatic-updates setting changes, and once at startup.
         */
        configure: (options: { automatic: boolean }) => Promise<UpdaterState>;
        check: (options?: { silent?: boolean }) => Promise<UpdaterState>;
        download: () => Promise<UpdaterState>;
        install: () => Promise<UpdaterState>;
        onState: (callback: (state: UpdaterState) => void) => Unsubscribe;
      };

      browserBar: {
        action: (
          name: "back" | "forward" | "reload" | "stop" | "navigate",
          value?: string,
        ) => Promise<{ success: boolean }>;
        setMenuOpen: (open: boolean) => Promise<{ success: boolean }>;
        setAdblock: (
          enabled: boolean,
        ) => Promise<{ success: boolean; enabled: boolean }>;
        onState: (callback: (state: BrowserBarState) => void) => Unsubscribe;
      };


      mcp: {
        catalogue: () => Promise<{
          success: boolean;
          servers: McpCatalogueEntry[];
        }>;
        config: () => Promise<{ success: boolean; config: Record<string, McpServerConfig> }>;
        save: (
          id: string,
          entry: McpServerConfig,
        ) => Promise<{ success: boolean; error?: string }>;
        forget: (id: string) => Promise<{ success: boolean }>;
        start: (
          id: string,
        ) => Promise<{ success: boolean; state: McpServerState; error?: string }>;
        stop: (id: string) => Promise<{ success: boolean }>;
        running: () => Promise<{ success: boolean; servers: McpServerState[] }>;
        enabled: (
          workspaceId: string,
        ) => Promise<{ success: boolean; ids?: string[] }>;
        setEnabled: (
          workspaceId: string,
          id: string,
          enabled: boolean,
        ) => Promise<{ success: boolean; ids?: string[] }>;
        search: (query: string) => Promise<{
          success: boolean;
          entries?: RegistryEntry[];
          cached?: boolean;
          stale?: boolean;
          error?: string;
        }>;
        startEnabled: (workspaceId?: string) => Promise<{ success: boolean; servers: McpServerState[] }>;
        signIn: (
          id: string,
        ) => Promise<{ success: boolean; error?: string }>;
        signOut: (id: string) => Promise<{ success: boolean }>;
        call: (
          serverId: string,
          toolName: string,
          args: Record<string, unknown>,
        ) => Promise<{ success: boolean; text?: string; error?: string }>;
        onState: (
          callback: (state: { servers: McpServerState[] }) => void,
        ) => Unsubscribe;
      };

      appInfo: () => Promise<AppInfo>;
      openLogs: () => Promise<string>;
      readLogs: () => Promise<string>;

      onDownloadProgress: (
        callback: (progress: DownloadProgressEvent) => void,
      ) => Unsubscribe;
      onBootModel: (callback: (model: string) => void) => Unsubscribe;
      bootFinished: (model: string) => void;
      quitApp: () => void;
    };
  }
}
