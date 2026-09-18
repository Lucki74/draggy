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

/** One line the renderer logger batches to the main process. Mirrors electron/logger.cjs's shape. */
export interface LogEntry {
  level: "DEBUG" | "INFO" | "WARN" | "ERROR";
  context: string;
  message: string;
  correlationId?: string | null;
  data?: unknown;
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
  /** Which workspace indexed it, and the only one that searches it. */
  workspaceId?: string;
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

export interface CommandResult {
  success: boolean;
  error?: string;
  exitCode?: number | null;
  signal?: string | null;
  timedOut?: boolean;
  cancelled?: boolean;
  /** What it printed, errors included, in order. The middle of a long output is cut. */
  output?: string;
  truncated?: boolean;
  durationMs?: number;
  shell?: string;
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
    /** Prose written between two tool calls. In the step list so it stays where it was written,
     * rather than collected up after the tool activity. */
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
    /** A skill's instructions loaded, by the model or by a slash command. */
    | "skill"
    /** An extension answering with a small interface of its own. */
    | "app"
    /** A look at the project's git repository. */
    | "git"
    /** A command run in the project's folder, with what it printed. */
    | "command"
    /** A tool borrowed from an MCP server, so the timeline shows those too. */
    | "extension";
  content: string;
  thoughtTime?: number;
  isComplete?: boolean;
  /** For a skill step whose instructions loaded, the skill's id, which keeps it loaded afterwards. */
  skill?: string;
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
  /** On an "app" step: the widget an extension returned, and who sent it. */
  app?: { serverId: string; html: string };
  /** On an "approval" step: the call the user is being asked about. */
  approval?: {
    id: string;
    tool: string;
    target?: string | null;
    reason: string;
    /** "command" for a shell command, shown as the command itself. */
    kind?: "command";
    /** For a command: what "always allow" would remember. Empty when it cannot be remembered. */
    allows?: string[];
  };
  /** What the user answered. Absent while the card is still waiting. */
  answer?: ApprovalAnswer;
  /** On a "loading" step: the model being loaded, and when it started, to count the seconds. */
  model?: string;
  startedAt?: number;
}

/** How far an approval goes: this call only, the rest of this task, or every time in this
 * workspace. "no" is a refusal of the call in front of the user. */
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
  /** What the prompt was spent on, measured on the last pass of the turn. */
  breakdown?: ContextBreakdown;
}

export interface ApiServerStatus {
  success: boolean;
  enabled: boolean;
  port: number;
  running: boolean;
  baseUrl: string;
  /** Only while enabled. */
  key: string | null;
  error: string | null;
}

/** A chat completion request as the main process has already checked it. */
export interface ApiCompletionRequest {
  model: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  stream: boolean;
}

export interface ApiCompletionResult {
  model: string;
  content: string;
  usage: { promptTokens: number; responseTokens: number };
}

/** One finished turn, as the statistics page counts it. Never leaves this machine. */
export interface MetricRow {
  recordedAt: number;
  workspaceId?: string | null;
  chatId?: string | null;
  model: string;
  promptTokens: number;
  responseTokens: number;
  /** Time spent generating, from Ollama's own count. */
  responseMs: number;
  firstTokenMs: number | null;
  loadMs: number;
  /** Wall-clock time from sending to the reply being done, tools included. */
  taskMs: number;
  loops: number;
  tools: Record<string, number>;
}

export type GitChangeKind =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked"
  | "conflicted";

export interface GitChange {
  /** Relative to the project folder, with forward slashes. */
  path: string;
  /** For a rename: where it was. */
  from?: string;
  kind: GitChangeKind;
  staged: boolean;
  unstaged: boolean;
}

export interface GitStatus {
  success: boolean;
  /** Whether a git is installed at all. */
  available: boolean;
  isRepo: boolean;
  branch?: string | null;
  detached?: boolean;
  upstream?: string | null;
  ahead?: number;
  behind?: number;
  files?: GitChange[];
  truncated?: boolean;
  counts?: Record<GitChangeKind, number>;
  error?: string;
}

export interface GitDiff {
  success: boolean;
  diff?: string;
  truncated?: boolean;
  staged?: boolean;
  /** Files the diff covers. */
  files?: number;
  /** Changed files left out because they hold credentials. */
  skipped?: number;
  error?: string;
}

/** The conversation being folded into notes, shown after the reply it followed. Kept once done, so
 * the user can see where the older messages went. */
export interface FoldMarker {
  status: "running" | "done";
  /** Roughly how many tokens of conversation went into the notes. */
  tokens: number;
  at: number;
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
  fold?: FoldMarker;
}

/** The older conversation, folded into notes. `throughIndex` is exclusive, and this describes what
 * goes on the wire, not what the conversation is. */
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
  source?: "registry";
}

/** A skill on disk, as it appears in the prompt: no body, just the offer. */
export interface InstalledSkill {
  id: string;
  name: string;
  description: string;
  /** A few words for the slash menu. */
  summary?: string;
  path: string;
  /** Shipped with Draggy, written by the user, or kept in the project. */
  source: "library" | "user" | "project";
  /** The library's grouping. Null for skills the user wrote. */
  category?: string | null;
  /** The side it is offered on. */
  surface?: "chat" | "code" | "both";
  enabled?: boolean;
  /** What it starts as before the user flips it. */
  defaultOn?: boolean;
  /** False when only a slash command may start it, never the model on its own. */
  modelInvocable?: boolean;
}

export interface LoadedSkill extends InstalledSkill {
  body: string;
  /** Anything else in the skill's folder, relative to it: templates, references, examples. */
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
  package?: string;
  description?: string;
  docs?: string;
  source?: "registry";
  /** Whether this server may answer with an interface rather than with text. */
  apps?: boolean;
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

/** How much a turn may do on its own. A workspace holds one of these, and every tool call is
 * measured against it. */
export type PermissionMode = "plan" | "ask" | "acceptEdits" | "auto";

export type WorkspaceKind = "chat" | "project";

/** The settings a workspace may override. Everything else (the theme, the voice, the update
 * schedule) stays a property of the app, not of the work. */
export type WorkspaceOverrides = Partial<
  Pick<
    AppSettings,
    | "modelName"
    | "customInstructions"
    | "thinkingMode"
    | "webMode"
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
import type { ContextBreakdown } from "./agent/contextBreakdown";

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
  /** Model that answers in Talk. Empty means automatic, which sizes a small conversational model to
   * the graphics card and downloads it on first use. */
  voiceModel: string;
  voiceEngine: "system" | "neural";
  neuralVoice: string;
  voiceRate: number;
  searchProvider: SearchProvider;
  searxngUrl: string;
  braveApiKey: string;
  /** The model Code runs. Empty uses the chat model. */
  codeModel: string;
  /** Instructions for every project, kept apart from the chat ones. */
  codeInstructions: string[];
  codeThinkingMode: "low" | "medium" | "high";
  codeWebMode: "auto" | "on" | "off";
  /** What a new project starts at. */
  codePermissionMode: PermissionMode;
  libraryEnabled: boolean;
  embedModel: string;
  showMetrics: boolean;
  /** Set once the user has flipped the speed line themselves. Until then it stays off, whatever an
   * older version saved. */
  metricsChosen?: boolean;
  autoUpdate: boolean;
  /** Tokens of conversation before it is folded into notes. Null leaves it to Draggy, which folds
   * at a share of the window the model is loaded at. */
  compactLimit: number | null;
  /** When set, Ollama is always loaded at this context window instead of the automatic size. */
  fixedContextSize: number | null;
  /** "release" only offers x.x.x tags; "prerelease" offers everything including x.x.x-label. */
  updateChannel: "release" | "prerelease";
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
        /** "empty" means the web had nothing; "unavailable" means no provider answered, which is
         * temporary and says nothing about the subject. */
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
        /** Something wrote, moved, removed or restored a file in a workspace. */
        onChanged: (
          callback: (change: { workspaceId: string; path: string; from?: string }) => void,
        ) => Unsubscribe;
      };

      apiServer: {
        status: () => Promise<ApiServerStatus>;
        configure: (config: { enabled?: boolean; port?: number }) => Promise<ApiServerStatus>;
        regenerateKey: () => Promise<ApiServerStatus>;
        /** Tells the main process this window can answer requests. */
        ready: () => void;
        onRequest: (callback: (message: { id: string; request: ApiCompletionRequest }) => void) => Unsubscribe;
        onAbort: (callback: (id: string) => void) => Unsubscribe;
        text: (id: string, text: string) => void;
        model: (id: string, model: string) => void;
        done: (id: string, result: ApiCompletionResult) => void;
        failed: (id: string, message: string) => void;
      };

      metrics: {
        record: (row: MetricRow) => Promise<{ success: boolean }>;
        /** Turns recorded since a time, newest first. */
        list: (since?: number) => Promise<{ success: boolean; rows?: MetricRow[] }>;
        clear: () => Promise<{ success: boolean; removed?: number }>;
      };

      git: {
        /** Where the project's repository stands. Hidden when git or the repository is absent. */
        status: (workspaceId: string) => Promise<GitStatus>;
        diff: (
          workspaceId: string,
          path?: string,
          staged?: boolean,
        ) => Promise<GitDiff>;
      };

      skills: {
        /** The user's skills, plus a project's own when one is named. */
        list: (
          workspaceId?: string,
        ) => Promise<{ success: boolean; skills?: InstalledSkill[] }>;
        read: (
          workspaceId: string,
          id: string,
          options?: { enabledOnly?: boolean; file?: string },
        ) => Promise<{
          success: boolean;
          skill?: LoadedSkill;
          file?: { name: string; content: string };
          error?: string;
        }>;
        setEnabled: (id: string, enabled: boolean) => Promise<{ success: boolean }>;
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
          /** How many sessions went with the project. */
          deleted?: number;
          error?: string;
        }>;
        pickFolder: () => Promise<{
          success: boolean;
          path?: string;
          cancelled?: boolean;
        }>;
      };

      library: {
        list: (
          workspaceId?: string,
        ) => Promise<{ success: boolean; sources?: LibrarySource[]; error?: string }>;
        stats: () => Promise<{ success: boolean; stats?: LibraryStats; error?: string }>;
        pickFolder: () => Promise<{ success: boolean; path?: string; cancelled?: boolean }>;
        index: (
          path: string,
          model: string,
          workspaceId?: string,
        ) => Promise<IndexResult>;
        remove: (id: number) => Promise<{ success: boolean }>;
        clear: () => Promise<{ success: boolean }>;
        search: (
          query: string,
          limit?: number,
          model?: string,
          options?: { source?: string; workspaceId?: string },
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

      commands: {
        /** Runs a command in the workspace's own folder. The id lets it be stopped. */
        run: (
          workspaceId: string,
          runId: string,
          command: string,
          options?: { shell?: string; timeoutMs?: number },
        ) => Promise<CommandResult>;
        cancel: (runId: string) => Promise<{ success: boolean }>;
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
        /** Turns background checking and downloading on or off. Sent whenever the automatic-updates
         * setting changes, and once at startup. */
        configure: (options: { automatic: boolean; channel?: "release" | "prerelease" }) => Promise<UpdaterState>;
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
        /** The servers switched on, for the whole app. */
        enabled: () => Promise<{ success: boolean; ids?: string[] }>;
        setEnabled: (id: string, enabled: boolean) => Promise<{ success: boolean; ids?: string[] }>;
        search: (query: string) => Promise<{
          success: boolean;
          entries?: RegistryEntry[];
          cached?: boolean;
          stale?: boolean;
          error?: string;
        }>;
        startEnabled: () => Promise<{ success: boolean; servers: McpServerState[] }>;
        signIn: (
          id: string,
        ) => Promise<{ success: boolean; error?: string }>;
        signOut: (id: string) => Promise<{ success: boolean }>;
        call: (
          serverId: string,
          toolName: string,
          args: Record<string, unknown>,
        ) => Promise<{
          success: boolean;
          text?: string;
          error?: string;
          app?: { uri: string; html: string };
        }>;
        onState: (
          callback: (state: { servers: McpServerState[] }) => void,
        ) => Unsubscribe;
      };

      widgets: {
        /** Puts a widget's markup where a frame can load it, once. */
        stage: (html: string) => Promise<{
          success: boolean;
          token?: string;
          url?: string;
        }>;
        release: (token: string) => Promise<{ success: boolean }>;
      };

      appInfo: () => Promise<AppInfo>;
      openLogs: () => Promise<string>;
      readLogs: (target: "debug" | "app", bytes?: number) => Promise<string>;
      logEntry: (entry: LogEntry) => void;
      logBatch: (entries: LogEntry[]) => void;

      onDownloadProgress: (
        callback: (progress: DownloadProgressEvent) => void,
      ) => Unsubscribe;
      onBootModel: (callback: (model: string) => void) => Unsubscribe;
      bootFinished: (model: string) => void;
      quitApp: () => void;
      /** Runs before Draggy quits and storage closes; the quit waits for it, up to a few seconds. */
      onBeforeQuit: (handler: () => Promise<void> | void) => Unsubscribe;

      terminal?: {
        spawn: (id: string, cwd?: string) => Promise<{ success: boolean; id: string; shell: string; error?: string }>;
        write: (id: string, data: string) => Promise<boolean>;
        kill: (id: string) => Promise<boolean>;
        onData: (callback: (payload: { id: string; data: string }) => void) => Unsubscribe;
        onExit: (callback: (payload: { id: string; code: number }) => void) => Unsubscribe;
      };

      gguf?: {
        status: () => Promise<{
          running: boolean;
          port: number;
          model: string | null;
          contextSize: number;
          baseUrl: string;
          hasBinary: boolean;
        }>;
        start: (options: {
          modelPath: string;
          contextSize?: number;
          gpuLayers?: number;
          port?: number;
        }) => Promise<{ success: boolean; port?: number; error?: string; alreadyRunning?: boolean }>;
        stop: () => Promise<{ success: boolean }>;
        listModels: () => Promise<{
          name: string;
          filename: string;
          size: number;
          path: string;
          architecture: string;
          contextLength: number | null;
          blockCount: number | null;
          fileType: number | null;
        }[]>;
        deleteModel: (filename: string) => Promise<boolean>;
        downloadModel: (options: { url: string; filename: string }) => Promise<{
          success: boolean;
          path?: string;
          filename?: string;
        }>;
        onProgress: (callback: (progress: {
          phase: "preparing" | "downloading" | "done";
          completed: number;
          total: number;
          percent: number;
        }) => void) => Unsubscribe;
      };
    };
  }
}
