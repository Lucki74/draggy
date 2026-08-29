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
    /**
     * Ordinary prose the model wrote between two tool calls. It lives in the
     * step list rather than in the message body so that it stays where it was
     * written, instead of being collected up and dumped after all the tool
     * activity.
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
    | "library"
    | "run_code";
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
}

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

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
  isGenerating: boolean;
  isOutOfContext?: boolean;
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
      installOllama: () => Promise<boolean>;
      checkInternet: () => Promise<boolean>;
      checkDiskSpace: () => Promise<number>;

      searchWeb: (query: string) => Promise<SearchResult[]>;
      searchWebDetailed: (query: string) => Promise<{
        results: SearchResult[];
        provider: string | null;
        tried: string[];
        /**
         * "empty" means the web was asked and had nothing. "unavailable" means
         * no provider would answer, which is temporary and says nothing about
         * the subject.
         */
        status: "ok" | "empty" | "unavailable";
        cached?: boolean;
      }>;
      setSearchConfig: (config: {
        searchProvider: string;
        searxngUrl: string;
        braveApiKey: string;
      }) => Promise<{ success: boolean }>;
      readUrl: (url: string) => Promise<{ title: string; text: string }>;

      browserNavigate: (url: string) => Promise<{ success: boolean; title?: string; url?: string; error?: string }>;
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
        ) => Promise<{
          success: boolean;
          results?: LibraryHit[];
          empty?: boolean;
          error?: string;
        }>;
        onProgress: (callback: (progress: LibraryProgress) => void) => void;
        offProgress: () => void;
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
        onState: (callback: (state: UpdaterState) => void) => void;
        offState: () => void;
      };

      appInfo: () => Promise<AppInfo>;
      openLogs: () => Promise<string>;
      readLogs: () => Promise<string>;

      onDownloadProgress: (
        callback: (progress: DownloadProgressEvent) => void,
      ) => void;
      offDownloadProgress: () => void;
      onBootModel: (callback: (model: string) => void) => void;
      bootFinished: (model: string) => void;
      quitApp: () => void;
    };
  }
}
