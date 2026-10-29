import type { ProviderState } from "./ai/providers";
import type { PriceTable } from "./stats/cost";
export type {
  QuestionType,
  QuestionOption,
  UserQuestion,
  UserAnswer,
  QuestionSession,
} from "./chat/questionTypes";

/** Drops one listener from a main-process channel, leaving the others alone. */
export type Unsubscribe = () => void;

export interface DriveBenchmark {
  seqMBps: number;
  expertMBps: number;
  rand4kMBps: number;
  rand4kIops: number;
  unbuffered: boolean;
  at: number;
  volume: string;
  sizeGB: number;
}

export interface HardwareDrive {
  volume: string;
  diskId: string | null;
  diskKey: string;
  name: string;
  bus: "nvme" | "sata" | "usb" | "unknown";
  role: "good" | "slow" | "refuse" | "unknown";
  sizeBytes: number;
  freeBytes: number;
  benchmark: DriveBenchmark | null;
}

export interface TierPlan {
  engine: "colibri" | "llamacpp" | "none";
  refusal?: { reason: string; suggestion: string };
  vram: { denseGB: number; expertGB: number; kvGB: number };
  ram: { denseGB: number; expertCacheGB: number; kvGB: number; reserveGB: number };
  disk: { volume: string | null; mirrors: string[]; coldGB: number };
  warnings: string[];
  estimated: boolean;
  expectedHitRate?: [number, number];
  expectedTokPerSec?: [number, number] | null;
  bottleneck?: "disk" | "vram" | "ram-bandwidth";
  needsDiskTest?: boolean;
  /** The speed range comes from replies measured on this computer, not from the estimate. */
  measured?: boolean;
}

export interface CatalogModel {
  id: string;
  name: string;
  repo: string;
  totalGB: number;
  denseGB: number;
  routedGB: number;
  ramMinGB: number;
  ramGoodGB: number;
  estimated?: boolean;
  downloaded: { dir: string; complete: boolean } | null;
  plan: TierPlan;
}

export interface HardwareReport {
  ram: { totalGB: number; availableGB: number };
  gpu: { name: string | null; vramGB: number; unified: boolean };
  cpu: { model: string | null; logical: number; physical: number; performance: number };
  drives: HardwareDrive[];
  smartAppControl: "off" | "on" | "evaluation" | "unknown";
}


export interface SystemSpecs {
  cpu: string;
  ram: number;
  vram: number;
  unifiedMemory?: boolean;
  /** The graphics card's name, when Electron's GPU report gives one. */
  gpu?: string | null;
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
  /** Hugging Face repo to download from, when `name` is only a display title. */
  repo?: string;
  description: string;
  capabilities: string[];
  sizes: string[];
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** Why a browser step failed: a stable code to branch on, a sentence, and what the model can try next. */
export interface BrowserFailure {
  code: string;
  message: string;
  hint: string;
}

/** The agent asking, in the Browser pane's bar, to act on a site or to do something that cannot be undone. */
export interface BrowserConsentAsk {
  id: string;
  kind: "site" | "action";
  host: string;
  detail: string;
}

export type BrowserResult<T = object> = ({ ok: true } & T) | { ok: false; error: BrowserFailure };

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
  error?: { name?: string; message?: string; stack?: string };
}

export interface DiagnosticsChoices {
  includeDebug?: boolean;
  includeDumps?: boolean;
}

export interface LogLevelState {
  level: string;
  scopes: string[];
  keep: boolean;
  until: number | null;
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
  /** Set when the command was moved to the background and is still running as this task. */
  detached?: boolean;
  background?: boolean;
  taskId?: string;
  task?: BackgroundTask;
  /** The folder the command ended in, when that is outside the project and was not followed. */
  outside?: string;
  notice?: string;
}

export type BackgroundTaskStatus = "running" | "exited" | "failed" | "stopped";

export interface BackgroundTask {
  /** `chatId/tN`, unique across chats. */
  uid: string;
  /** `tN`, the id the model uses within its chat. */
  id: string;
  chatId: string;
  command: string;
  shell: string;
  mode: "pty" | "pipe" | "adopted";
  status: BackgroundTaskStatus;
  exitCode: number | null;
  signal: string | null;
  startedAt: number;
  endedAt: number | null;
  /** True while the task runs on a terminal the user or the model can type into. */
  canInput: boolean;
  lastLine: string;
  error: string | null;
}

export interface TaskInboxItem {
  uid: string;
  id: string;
  command: string;
  status: BackgroundTaskStatus;
  exitCode: number | null;
  durationMs: number;
  tail: string;
}

export type TaskEvent =
  | { type: "started"; chatId: string; task: BackgroundTask }
  | { type: "output"; chatId: string; uid: string; chunk: string }
  | { type: "ended"; chatId: string; task: BackgroundTask; wake: boolean };

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
  /** A loading step for a reload at a bigger window, which shows as one "Extending context" step. */
  extending?: boolean;
  type:
    | "thinking"
    /** The GGUF engine loading the weights, gone again at the first token. */
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
    /** A question the model put to the user, with the form to answer it. */
    | "question"
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
    | "extension"
    /** A picture made by the local image engine, shown as a card. */
    | "image"
    /** A note the user added while the turn ran, handed to the model at its next step. */
    | "steer";
  content: string;
  thoughtTime?: number;
  isComplete?: boolean;
  /** For a step that opened or read a web page, the address. The group title names the site. */
  url?: string;
  /** For a skill step whose instructions loaded, the skill's id, which keeps it loaded afterwards. */
  skill?: string;
  results?: SearchResult[];
  filepath?: string;
  filename?: string;
  fileContent?: string;
  /** On a "create_file" step: the context ran out mid-file, so nothing was saved. */
  cut?: boolean;
  libraryHits?: SearchStepLibraryHit[];
  language?: string;
  stdout?: string;
  stderr?: string;
  /** On a "command" step: the id the main process knows the run by, which lets it be sent to the background. */
  runId?: string;
  /** On a "command" step: the background task it became or started as. */
  taskId?: string;
  /** On an "edit_file" step: what to hand a revert, and what changed. */
  checkpointId?: number;
  before?: string;
  after?: string;
  /** On an "edit_file" step: the file was new, moved or deleted rather than changed. */
  change?: "created" | "moved" | "deleted";
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
  /** On a "question" step: what the model asked. */
  question?: UserQuestion;
  /** On a "question" step: the reply, or "cancelled". Absent while the form is still waiting. */
  reply?: UserReply | "cancelled";
  /** On a "loading" step: the model being loaded, and when it started, to count the seconds. */
  model?: string;
  startedAt?: number;
  /** On a "loading" step: a provider's retry, counted down to when the next attempt goes out. */
  retry?: { attempt: number; of: number; until: number };
  /** On an "image" step: what was asked and where the result is. Never the image's bytes. */
  image?: ImageStepInfo;
}

export type ImageStatus = "loading-model" | "queued" | "generating" | "done" | "error" | "cancelled";

export interface ImageStepInfo {
  prompt: string;
  status: ImageStatus;
  requestId?: string;
  /** Where the file was saved: the output folder, or a project the conversation works in. */
  location?: "created" | "project";
  workspaceId?: string;
  path?: string;
  filename?: string;
  width?: number;
  height?: number;
  seed?: number;
  model?: string;
  queuePosition?: number;
  /** When the job started, to count the seconds while it runs. */
  startedAt?: number;
  finishedAt?: number;
  /** Already in the reader's language, with a link to the article on it when there is one. */
  error?: string;
}

export interface ImageModelFile {
  role: string;
  filename: string;
  size: number;
  present: boolean;
  /** Bytes already fetched; the whole file once present. Absent on user-added files. */
  onDisk?: number;
}

export interface ImageModelEntry {
  id: string;
  name: string;
  variant: string;
  kind: "single" | "bundle";
  curated: boolean;
  installed: boolean;
  partial: boolean;
  size: number;
  /** Bytes of the download's files already on disk. Absent on user-added files. */
  onDiskBytes?: number;
  vramGB: number;
  defaults: { width: number; height: number; steps: number; cfgScale: number; maxSide?: number };
  license: string;
  licenseUrl: string;
  files: ImageModelFile[];
}

export interface ImageEngineStatus {
  success: boolean;
  release?: string;
  installed: boolean;
  runner: string | null;
  source: "app" | "path" | null;
  runners: string[];
  defaultRunner: string | null;
  model: string;
  models: ImageModelEntry[];
  ready: boolean;
  server?: { running: boolean; model: string | null; busy: boolean; queued: number };
  error?: string;
}

/** What the main process sends while the image engine works; `requestId` is absent for downloads. */
export interface ImageProgress {
  requestId?: string;
  modelId?: string;
  /** The model list's name for a download it started, which its queue follows. */
  reference?: string;
  status:
    | ImageStatus
    | "engine-download"
    | "model-download"
    | "model-verify"
    | "model-done";
  position?: number;
  percent?: number;
  completed?: number;
  total?: number;
  remainingSeconds?: number | null;
  phase?: string;
}

export interface ImageRequest {
  requestId: string;
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  seed?: number;
  strength?: number;
  hires?: boolean;
  fitModel?: boolean;
  lora?: string[];
  model?: string;
  init?: { kind: "attachment"; dataUrl: string } | { kind: "project"; workspaceId: string; path: string };
  destination?:
    | { kind: "chat" }
    | { kind: "project"; workspaceId: string; path: string; chatId?: string; overwrite?: boolean };
}

export interface ImageResult {
  success: boolean;
  path?: string;
  filename?: string;
  width?: number;
  height?: number;
  seed?: number;
  model?: string;
  checkpointId?: number;
  created?: boolean;
  code?: string;
  error?: string;
  params?: Record<string, string>;
}

/** How far an approval goes: this call only, the rest of this task, or every time in this
 * workspace. "no" is a refusal of the call in front of the user. */
export type ApprovalAnswer = "once" | "task" | "workspace" | "no";

/** A question the model asks the user: pick from the options, or write an answer. */
export interface UserQuestion {
  id: string;
  text: string;
  /** Empty means free text only. */
  options: string[];
  /** More than one option may be picked. */
  multiple: boolean;
}

/** What the user sent back: the options picked and/or the words written. */
export interface UserReply {
  choices: string[];
  text: string;
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
  /** What the window held when the turn ended: the last pass's prompt and reply. */
  contextTokens?: number;
  /** What the prompt was spent on, measured on the last pass of the turn. */
  breakdown?: ContextBreakdown;
  /** One entry per request the turn made, so a long prompt that moved one request into a dearer tier prices right. */
  passUsage?: import("./stats/tokenUsage").TokenUsage[];
  /** Who answered, who pays and what it came to. Absent on replies from before costs were kept. */
  cost?: TurnCost;
}

/** The part of a recorded turn that is about money. */
export type TurnCost = Pick<
  MetricRow,
  | "providerId"
  | "kind"
  | "inputTokens"
  | "cacheReadTokens"
  | "cacheWriteTokens"
  | "outputTokens"
  | "reasoningTokens"
  | "costMicros"
  | "costSource"
  | "priceUpdatedAt"
>;

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
  /** Time spent generating, from the engine's own count. */
  responseMs: number;
  firstTokenMs: number | null;
  loadMs: number;
  /** Wall-clock time from sending to the reply being done, tools included. */
  taskMs: number;
  loops: number;
  tools: Record<string, number>;
  /** Which provider instance answered; absent for the built-in engine and for rows from before costs were kept. */
  providerId?: string | null;
  /** Who pays for the turn. Absent on old rows, which the statistics page prices from the model name. */
  kind?: "billed" | "account" | "local" | null;
  /** The token split, summed over the turn's passes. Null where the engine reported no split. */
  inputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
  outputTokens?: number | null;
  reasoningTokens?: number | null;
  /** Whole micro-dollars, or null when no price was known. Never 0 for "unknown". */
  costMicros?: number | null;
  costSource?: "reported" | "table" | "estimated" | "unknown" | null;
  /** The price table's `generatedAt` the figure was worked out from. */
  priceUpdatedAt?: string | null;
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

export interface GitCommit {
  hash: string;
  short: string;
  author: string;
  date: string;
  subject: string;
}

export interface GitLog {
  success: boolean;
  commits?: GitCommit[];
  error?: string;
}

export interface GitBranch {
  name: string;
  current: boolean;
  upstream?: string;
}

export interface GitBranches {
  success: boolean;
  branches?: GitBranch[];
  error?: string;
}

/** What stage, unstage, commit and checkout answer. */
export interface GitWrite {
  success: boolean;
  files?: number;
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
  /** What the provider that wrote this reply needs back next turn; sent to that instance only. */
  provider_state?: ProviderState;
  /** The turn ended in an error, described by `error`; content keeps only what was generated. */
  failed?: boolean;
  error?: string;
  errorKind?: TurnErrorKind;
  /** The user stopped this reply; what it had written is kept. */
  stopped?: boolean;
  /** On a user message's earlier wording. */
  attachments?: Attachment[];
  /** The conversation that followed this version, put back when it is shown again. */
  tail?: Message[];
}

/** Why a turn failed, which decides what the failure offers. */
export type TurnErrorKind = "engine" | "memory" | "network" | "rate-limit" | "context" | "budget" | "unknown";

/** A message written while a turn ran, sent when it ends. */
export interface QueuedMessage {
  id: string;
  content: string;
  attachments?: Attachment[];
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
  provider_state?: ProviderState;
  /** The turn ended in an error, described by `error`; content keeps only what was generated. */
  failed?: boolean;
  error?: string;
  errorKind?: TurnErrorKind;
  /** The user stopped this reply; what it had written is kept. */
  stopped?: boolean;
  /** The app closed while this reply was being written. */
  interrupted?: boolean;
  /** The conversation after the newest version, kept while an older version is shown. */
  tail?: Message[];
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
  /** Always on: the user cannot switch it off. Present only when true. */
  locked?: boolean;
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
    | "effort"
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
  /** What the chat was last left on, restored when it is opened again. */
  generation?: { model?: string; effort?: EffortLevel } | null;
  isGenerating: boolean;
  isOutOfContext?: boolean;
  /** The window numbers when the reply was cut. Not stored: a restart keeps only the flag. */
  outOfContextInfo?: { loaded: number; modelMax: number | null; used: number; canGrow: boolean };
  compaction?: CompactionState | null;
  /** Kept at the top of the sidebar. */
  pinned?: boolean;
  /** Finished while the user was elsewhere. */
  unread?: boolean;
  /** Whether interactive AI questions are toggled off for this chat. */
  aiQuestionsDisabled?: boolean;
  /** How much work the transcript shows. Missing means normal. */
  view?: import("./chat/transcriptView").TranscriptView;
  /** Saved dock panes, active tab and width for this session. */
  dock?: import("./app/dockLayout").DockLayout;
}

export type SearchProvider =
  | "auto"
  | "duckduckgo"
  | "startpage"
  | "searxng"
  | "brave"
  | "brave-html";

/** How the first-run setup ended. "adopted" is an existing install that never saw it. */
export type OnboardingPath = "local" | "provider" | "both" | "skipped";

export interface OnboardingRecord {
  version: number;
  status: "in-progress" | "done";
  path?: OnboardingPath | "adopted";
  startedAt?: string;
  completedAt?: string;
}

/** A provider's failure by kind, as main names it; `providerMessage` is the provider's own words. */
export interface ProviderFailure {
  kind: string;
  status?: number;
  message?: string;
  providerMessage?: string;
  retryAfter?: number;
}

export type ProviderCapability = "tools" | "vision" | "thinking";

/** One provider the user set up, as main shows it: whether a key is stored, never the key. */
export interface ProviderInstance {
  id: string;
  type: string;
  label: string;
  name: string;
  kind: "cloud" | "local" | "account";
  protocol: string;
  baseUrl: string;
  enabled: boolean;
  pinnedModels: string[];
  promptProfile: "auto" | "compact" | "full";
  modelOverrides: Record<string, Partial<Record<ProviderCapability, boolean>>>;
  headers?: Record<string, string>;
  hasKey: boolean;
  keyHint: string;
  needsKey: boolean;
  /** Curated models providers.json added after the user last chose theirs. */
  newModels: string[];
}

export interface ProviderCatalogEntry {
  id: string;
  name: string;
  kind: "cloud" | "local" | "account";
  protocol: string;
  /** Set on a plan and its API-key twin alike, so adding the vendor asks which way. */
  vendor: "openai" | "anthropic" | "google" | null;
  keyUrl: string | null;
  needsKey: boolean;
  /** False when it needs a key and this system has no keystore to keep one in. */
  available: boolean;
  baseUrl: string | null;
  editableBaseUrl: boolean;
  remote: boolean;
  /** Bytes an account's first sign-in fetches, while its runtime is not on disk yet. */
  download?: number | null;
}

export interface ProviderModel {
  id: string;
  /** `@instance/model`, the name every model request carries. */
  ref: string;
  /** The provider's own name for it, where it gives one ("Opus 5.5" for `opus`). */
  name?: string | null;
  contextLength: number | null;
  maxOutputTokens: number | null;
  capabilities: string[];
  /** Whether what it reads leaves this computer. */
  cloud: boolean;
  pinned: boolean;
  override: Partial<Record<ProviderCapability, boolean>> | null;
}

export interface DiscoveredServer {
  type: string;
  name: string;
  port: number;
  baseUrl: string;
  /** Named after the port's usual server, since it answered only a model listing. */
  guessed: boolean;
}

/** A plan's usage window as the vendor reports it; `window` in minutes, `resetsAt` in epoch seconds. */
export interface AccountLimit {
  window: number | null;
  usedPercent: number;
  resetsAt: number | null;
}

export interface AccountStatus {
  signedIn: boolean;
  email?: string;
  plan?: string;
  limits?: AccountLimit[];
  cancelled?: boolean;
  error?: string | null;
  /** Signed in before through a route that no longer exists, so the account needs the new sign-in. */
  reauth?: boolean;
}

export type AccountProgress =
  | { id: string; step: "installing"; percent: number }
  | { id: string; step: "browser"; url: string }
  | { id: string; step: "code"; url: string }
  | { id: string; step: "done" };

type ProviderResult<T> = ({ success: true } & T) | { success: false; error: ProviderFailure };

export type Language = "en" | "fr" | "es" | "zh";

/** How hard a model reasons. Off sends no reasoning; each level above it asks for more. */
export type EffortLevel = "off" | "low" | "medium" | "high" | "max";

/** A daily and a monthly cap in micro-dollars; null leaves that period unlimited. */
export interface BudgetLimits {
  dailyMicros: number | null;
  monthlyMicros: number | null;
}

/** Caps on what billed replies may cost. Reaching one stops new cloud sends until the user continues anyway. */
export interface BudgetSettings {
  enabled: boolean;
  global: BudgetLimits;
  /** Per provider instance id. */
  providers: Record<string, BudgetLimits>;
}

/** Where the price table and the exchange rates stand, as the main process last saw them. */
export interface PricingStatus {
  origin: "live" | "bundled" | "none";
  pricesGeneratedAt: string | null;
  priceCount: number;
  ratesDate: string | null;
  pricesAt: number | null;
  pricesError: string | null;
  ratesAt: number | null;
  ratesError: string | null;
}

/** Units of each currency for one US dollar. */
export interface ExchangeRates {
  base: "USD";
  date: string;
  fetchedAt: number;
  rates: Record<string, number>;
}

export interface AppSettings {
  /** "system" follows the operating system, and is what a new install starts on. */
  theme: "light" | "dark" | "system";
  /** One of the seven accents in src/app/accent.ts. */
  accent: string;
  fontSize: "sm" | "base" | "lg";
  language: Language;
  modelName: string;
  customInstructions: string[];
  /** The level the composer is on now. A new chat starts from `defaultEffort`. */
  effort: EffortLevel;
  /** The level new chats start at. */
  defaultEffort: EffortLevel;
  /** Where a new chat's thinking level starts: the default level, or where the last chat was left. */
  newChatStart: "defaults" | "last";
  /** Lets Chat use Max, the slowest level. Code always may. */
  allowMaxInChat: boolean;
  /** Lets a slow model (under 3 tokens per second) think; off by default because thinking multiplies the wait. */
  slowModelThinking: boolean;
  /** Lets colibri route to cached experts when the true ones are on disk: faster, and answers may change. */
  colibriLossy: boolean;
  webMode: "on" | "off";
  /** Lets the agent hover, drag, scroll, pick options, wait and click by position in the browser pane. */
  browserActions?: boolean;
  voiceName: string;
  /** Model that answers in Talk. Empty means automatic, which sizes a small conversational model to
   * the graphics card and downloads it on first use. */
  voiceModel: string;
  voiceEngine: "system" | "neural" | "cloud";
  neuralVoice: string;
  /** The provider (an OpenAI or Gemini provider id) a cloud voice speaks through, its voice and model. */
  cloudProvider: string;
  cloudVoice: string;
  cloudModel: string;
  voiceRate: number;
  /** Breaths, sighs, hums and laughs in Talk, so the voice sounds like a person rather than a reader. */
  voiceSounds: boolean;
  /** Short chimes when Talk is ready or ends and when the microphone is muted. */
  interfaceSounds: boolean;
  searchProvider: SearchProvider;
  searxngUrl: string;
  /** The model Code runs. Empty uses the chat model. */
  codeModel: string;
  /** Instructions for every project, kept apart from the chat ones. */
  codeInstructions: string[];
  codeEffort: EffortLevel;
  /** The level new code sessions start at. */
  codeDefaultEffort: EffortLevel;
  codeWebMode: "on" | "off";
  /** The shell run_command uses when the model names none. "auto" is bash from Git for Windows, then PowerShell. */
  defaultShell: "auto" | "bash" | "pwsh" | "powershell" | "cmd";
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
  /** When set, the model is always loaded at this context window instead of the automatic size. */
  fixedContextSize: number | "max" | null;
  /** "release" only offers x.x.x tags; "prerelease" offers everything including x.x.x-label. */
  /** The image model to draw with. Empty uses the first one installed. */
  imageModel: string;
  /** The size images are drawn at, as width and height in pixels: "1024x1024". */
  imageResolution: string;
  aiQuestionsEnabled?: boolean;
  aiQuestionsRequireAnswer?: boolean;
  aiQuestionsShowSessionBar?: boolean;
  aiQuestionsAutoSkip?: boolean;
  aiQuestionsMaxPerSession?: number;
  aiQuestionsTimeoutMinutes?: number;
  budgets?: BudgetSettings;
  /** Fetch fresh prices and exchange rates in the background. */
  priceRefresh?: boolean;
  /** ISO code the costs are shown in. They are stored in US dollars either way. */
  displayCurrency?: string;
  /** The model a local reply is priced against for "saved", as `provider/model`. */
  referenceModel?: string;
}

declare global {
  interface Window {
    electronAPI?: {
      notifyDone: (title: string, body: string) => Promise<{ shown: boolean }>;
      tier: {
        catalog: (contextTokens?: number) => Promise<{ hardware: HardwareReport; models: CatalogModel[] }>;
        record: (sample: { tokPerSec: number; tokens: number }) => Promise<{ recorded: boolean }>;
        report: () => Promise<{ file: string }>;
      };
      hardware: {
        probe: () => Promise<HardwareReport>;
        benchmark: (volume: string, options?: { sizeGB?: number }) => Promise<{ ok: boolean; error?: string; detail?: string; diskKey?: string; benchmark?: DriveBenchmark }>;
        cancelBenchmark: () => Promise<unknown>;
        onBenchmarkProgress: (callback: (progress: { phase: string; done: number; total: number }) => void) => () => void;
      };
      largeModel: {
        plan: (repo: string) => Promise<{ success: boolean; error?: string; files?: number; totalBytes?: number; target?: { ok: boolean; volume?: string; reason?: string; needBytes: number } }>;
        download: (options: { repo: string; destDir?: string; bandwidthBps?: number }) => Promise<{ ok: boolean; error?: string; needBytes?: number; doneBytes?: number; destDir?: string }>;
        cancel: () => Promise<{ success: boolean }>;
        getMirrors: (modelId: string) => Promise<string[]>;
        setMirrors: (modelId: string, paths: string[]) => Promise<string[]>;
        onProgress: (callback: (progress: { repo: string; doneBytes: number; totalBytes: number; bytesPerSecond: number; etaSeconds: number | null; file: string | null }) => void) => () => void;
      };
      colibri: {
        status: () => Promise<{ installed: boolean; state: { current: string | null; previous: string | null; variant: string | null }; engine: { kind: string | null; running: boolean; port: number | null; model: string | null; slow?: boolean } }>;
        install: () => Promise<{ success: boolean; tag?: string; variant?: string; error?: string }>;
        rollback: () => Promise<{ tag: string | null }>;
        health: () => Promise<{ status: string | null; tiers: { vramExperts: number; ramExperts: number; diskExperts: number }; scheduler: { active: number; queued: number; capacity: number; completed: number } } | null>;
        start: (options: { modelDir: string; modelName?: string; modelId?: string; lossy?: boolean; plan: unknown }) => Promise<{ success: boolean; port?: number; baseUrl?: string; loadMs?: number; error?: string; kind?: string; params?: Record<string, string> }>;
        stop: () => Promise<{ success: boolean }>;
        onInstallProgress: (callback: (progress: { phase?: string; percent?: number; file?: string }) => void) => () => void;
        onLoadPhase: (callback: (phase: { phase: "engine" | "dense" | "experts" | "ready"; elapsedMs: number }) => void) => () => void;
      };
      getSystemSpecs: () => Promise<SystemSpecs>;
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
      }) => Promise<{ success: boolean }>;
      /** Write-only; an empty key removes it. `kept` is false when no keystore holds it past this run. */
      setBraveKey: (key: string) => Promise<{ success: boolean; kept: boolean }>;
      braveKeyStatus: () => Promise<{ hasKey: boolean; keyHint: string; keystore: boolean }>;
      readUrl: (url: string) => Promise<{
        title: string;
        text: string;
        /** Set when the page could not be read rather than had no content. */
        blocked?: "human-verification" | "refused" | "unreachable";
        /** Why a refused or unreachable address failed, worded for the model. */
        reason?: string;
        url?: string;
      }>;

      browserNavigate: (url: string) => Promise<BrowserResult<{ title: string; url: string }>>;
      browserGetElements: () => Promise<BrowserResult<{ elements: BrowserElement[] }>>;
      browserClick: (
        target: number | string | null,
        options?: { x?: number; y?: number; button?: string; count?: number; modifiers?: string[] },
      ) => Promise<BrowserResult<{ title: string; url: string; changed?: string }>>;
      browserSnapshot: (options?: { scope?: string; maxItems?: number }) => Promise<
        BrowserResult<{ title: string; url: string; text: string; total: number; omitted: number }>
      >;
      browserScreenshot: (options?: { mode?: "viewport" | "full" | "element"; ref?: string; marks?: boolean }) => Promise<
        BrowserResult<{ data: string; width: number; height: number; url: string }>
      >;
      browserType: (
        target: number | string,
        text: string,
        options?: { clear?: boolean; submit?: boolean; slowly?: boolean },
      ) => Promise<BrowserResult<{ value?: string; landed?: boolean; changed?: string }>>;
      browserPressKey: (key: string, options?: { repeat?: number }) => Promise<BrowserResult<{ changed?: string }>>;
      browserHover: (target: string | { x: number; y: number }) => Promise<BrowserResult<{ changed?: string }>>;
      browserDrag: (
        from: string | { x: number; y: number },
        to: string | { x: number; y: number },
      ) => Promise<BrowserResult<{ changed?: string }>>;
      browserScroll: (options: { ref?: string; dx?: number; dy?: number; to?: "top" | "bottom" }) => Promise<
        BrowserResult<{ scroll: { y: number; max: number } }>
      >;
      browserSelectOption: (ref: string, choice: { value?: string; label?: string }) => Promise<
        BrowserResult<{ chosen: string; value: string; changed?: string }>
      >;
      browserWait: (options: { text?: string; url?: string; ms?: number; timeoutMs?: number }) => Promise<
        BrowserResult<{ waited: number }>
      >;
      browserHistory: (action: "back" | "forward" | "reload") => Promise<BrowserResult<{ title: string; url: string }>>;
      browserTabs: (
        action: "list" | "new" | "select" | "close",
        options?: { index?: number; url?: string },
      ) => Promise<BrowserResult<{ tabs: { index: number; active: boolean; title: string; url: string }[] }>>;
      browserTrace: (
        kind: "console" | "network",
        options?: { limit?: number; onlyFailed?: boolean },
      ) => Promise<BrowserResult<{ entries: Record<string, unknown>[] }>>;
      browserDialog: (action: "accept" | "dismiss", text?: string) => Promise<
        BrowserResult<{ answered: string; url: string; downloads?: { name: string; bytes: number }[] }>
      >;
      browserGetText: (options?: { ref?: string; selector?: string }) => Promise<
        BrowserResult<{ title: string; text: string; url: string }>
      >;
      browserClose: () => Promise<{ ok: true }>;

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
        /** The whole file as base64, sent for Word files so they can be drawn as pages. */
        data?: string;
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
      resolveModelUrl: (
        reference: string,
        options?: { includeDraft?: boolean },
      ) => Promise<{
        url: string;
        filename: string;
        size?: number;
        // Parts of a multi-part model or model + draft.
        parts?: { url: string; filename: string; size?: number }[];
        draft?: { url: string; filename: string; size?: number };
      } | null>;

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
          isImage?: boolean;
          isMedia?: boolean;
          mime?: string;
          dataUrl?: string;
          error?: string;
        }>;
        write: (
          workspaceId: string,
          path: string,
          contents: string,
          chatId?: string,
        ) => Promise<FileWriteResult & { before?: string; after?: string }>;
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
        /** Opens a project file in its default app; a runnable file is revealed instead. */
        open: (workspaceId: string, path: string) => Promise<{ success: boolean; revealed?: boolean; error?: string }>;
        reveal: (workspaceId: string, path: string) => Promise<{ success: boolean; error?: string }>;
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

      pricing: {
        /** The rate card replies are priced from: a refreshed copy when there is one, else the snapshot that ships. */
        table: () => Promise<{ success: boolean; table?: PriceTable; origin?: "live" | "bundled" }>;
        /** Turns the background refresh on or off. Off sends nothing on its own. */
        configure: (options: { automatic: boolean }) => Promise<{ success: boolean }>;
        /** The user asked for fresh prices and rates now. */
        refresh: () => Promise<{
          success: boolean;
          prices?: { ok: boolean; error?: string };
          rates?: { ok: boolean; error?: string };
          status?: PricingStatus;
        }>;
        status: () => Promise<{ success: boolean; status?: PricingStatus }>;
        /** Units of each currency per US dollar, or null before the first download. */
        rates: () => Promise<{ success: boolean; rates?: ExchangeRates | null }>;
        onUpdated: (callback: (status: PricingStatus) => void) => () => void;
      };

      git: {
        /** Where the project's repository stands. Hidden when git or the repository is absent. */
        status: (workspaceId: string) => Promise<GitStatus>;
        diff: (
          workspaceId: string,
          path?: string,
          staged?: boolean,
          untracked?: boolean,
        ) => Promise<GitDiff>;
        log: (workspaceId: string, limit?: number) => Promise<GitLog>;
        branches: (workspaceId: string) => Promise<GitBranches>;
        stage: (workspaceId: string, paths: string[]) => Promise<GitWrite>;
        unstage: (workspaceId: string, paths: string[]) => Promise<GitWrite>;
        commit: (workspaceId: string, message: string) => Promise<GitWrite & { hash?: string | null }>;
        checkout: (workspaceId: string, branch: string) => Promise<GitWrite & { branch?: string }>;
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
          options?: {
            shell?: string;
            defaultShell?: string;
            timeoutMs?: number;
            /** The chat the command belongs to: its folder, environment and tasks carry over. */
            chatId?: string;
            /** Start it as a background task and return at once. */
            background?: boolean;
            /** Move it to the background at the time limit instead of stopping it. Default true. */
            autoDetach?: boolean;
          },
        ) => Promise<CommandResult>;
        cancel: (runId: string) => Promise<{ success: boolean }>;
        /** Moves a running foreground command to the background. */
        detach: (runId: string) => Promise<{ success: boolean; taskId?: string; error?: string }>;
        /** Forgets the folder and environment a chat's commands built up. */
        resetState: (chatId: string) => Promise<{ success: boolean }>;
        /** Output of a running command as it arrives. */
        onOutput: (callback: (event: { runId: string; chunk: string }) => void) => () => void;
      };

      tasks: {
        list: (chatId: string) => Promise<{ success: boolean; tasks?: BackgroundTask[] }>;
        output: (
          chatId: string,
          id: string,
          options?: { since?: number; tail?: number; grep?: string; max_chars?: number },
        ) => Promise<{ success: boolean; error?: string; task?: BackgroundTask; output?: string; truncated?: boolean; next?: number }>;
        wait: (
          chatId: string,
          id: string,
          options?: { seconds?: number; until?: string; waitId?: string },
        ) => Promise<{ success: boolean; error?: string; reason?: "ended" | "matched" | "timeout" | "aborted"; task?: BackgroundTask }>;
        abortWait: (waitId: string) => Promise<{ success: boolean }>;
        stop: (chatId: string, id: string) => Promise<{ success: boolean; error?: string; task?: BackgroundTask; alreadyEnded?: boolean }>;
        write: (chatId: string, id: string, data: string) => Promise<{ success: boolean; error?: string; task?: BackgroundTask }>;
        /** Keystrokes from the user's terminal view. No reply. */
        input: (chatId: string, id: string, data: string) => void;
        resize: (uid: string, cols: number, rows: number) => Promise<{ success: boolean }>;
        snapshot: (uid: string) => Promise<{ success: boolean; error?: string; task?: BackgroundTask; data?: string }>;
        /** Tasks that ended since the model last looked; each is returned once. */
        takeInbox: (chatId: string) => Promise<{ success: boolean; items?: TaskInboxItem[] }>;
        hasRunning: (chatId: string) => Promise<{ success: boolean; running?: boolean }>;
        forget: (chatId: string) => Promise<{ success: boolean }>;
        onEvent: (callback: (event: TaskEvent) => void) => () => void;
      };

      shell: {
        /** The shells installed here; PowerShell and pwsh are one entry. */
        list: () => Promise<{ success: boolean; shells?: string[] }>;
        /** Opens an interactive shell in the workspace's folder. The id is minted by the main process. */
        open: (
          workspaceId: string,
          options?: { shell?: string; defaultShell?: string; cols?: number; rows?: number },
        ) => Promise<{ success: boolean; id?: string; shell?: string; notice?: string; unavailable?: boolean; error?: string }>;
        write: (id: string, data: string) => void;
        resize: (id: string, cols: number, rows: number) => Promise<{ success: boolean }>;
        close: (id: string) => Promise<{ success: boolean }>;
        onData: (callback: (event: { id: string; data: string }) => void) => () => void;
        onExit: (callback: (event: { id: string; exitCode: number }) => void) => () => void;
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
        configure: (options: { automatic: boolean }) => Promise<UpdaterState>;
        check: (options?: { silent?: boolean }) => Promise<UpdaterState>;
        download: () => Promise<UpdaterState>;
        install: () => Promise<UpdaterState>;
        onState: (callback: (state: UpdaterState) => void) => Unsubscribe;
      };

      browserBar: {
        action: (
          name: "back" | "forward" | "reload" | "stop" | "navigate" | "external" | "popout",
          value?: string,
        ) => Promise<{ success: boolean }>;
        setMenuOpen: (open: boolean) => Promise<{ success: boolean }>;
        setAdblock: (
          enabled: boolean,
        ) => Promise<{ success: boolean; enabled: boolean }>;
        onState: (callback: (state: BrowserBarState) => void) => Unsubscribe;
      };

      browserPane: {
        setBounds: (rect: { x: number; y: number; width: number; height: number }) => Promise<{ success: boolean }>;
        setVisible: (visible: boolean) => Promise<{ success: boolean }>;
        onOpen: (callback: () => void) => Unsubscribe;
      };

      browserAgent: {
        stop: () => Promise<{ success: boolean }>;
        release: () => Promise<{ success: boolean }>;
        onState: (callback: (state: { active: boolean; step: string | null }) => void) => Unsubscribe;
        onConsent: (callback: (ask: BrowserConsentAsk | null) => void) => Unsubscribe;
        answerConsent: (id: string, choice: "session" | "once" | "always" | "deny") => Promise<{ success: boolean }>;
        trustedSites: () => Promise<string[]>;
        revokeSite: (origin: string) => Promise<{ success: boolean }>;
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
          correlationId?: string,
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

      onboarding: {
        /** The plan main settled on at boot, and the record as stored now. */
        state: () => Promise<{ plan: "show" | "done"; record: OnboardingRecord | null }>;
        start: () => Promise<{ success: boolean; record: OnboardingRecord | null }>;
        complete: (path: OnboardingPath) => Promise<{ success: boolean; record?: OnboardingRecord; error?: string }>;
        /** Marks the setup as not done and relaunches into it. */
        reset: () => Promise<{ success: boolean }>;
      };

      tts: {
        providers: () => Promise<{
          providers: { id: string; name: string; configured: boolean }[];
          consent: Record<string, string[]>;
        }>;
        grantConsent: (provider: string) => Promise<{ success: boolean; code?: string }>;
        revokeConsent: (provider: string) => Promise<{ success: boolean }>;
        speak: (
          turnId: number,
          request: { provider: string; text: string; voice?: string; model?: string },
        ) => Promise<{ success: boolean; code?: string; characters?: number; frames?: number }>;
        cancel: (turnId: number) => Promise<{ success: boolean }>;
        /** Returns a cleanup function. */
        onFrames: (callback: (frame: { turnId: number; pcm: Int16Array; sampleRate: number }) => void) => () => void;
      };

      providers: {
        catalog: () => Promise<ProviderCatalogEntry[]>;
        list: () => Promise<ProviderInstance[]>;
        add: (input: { type: string; label?: string; baseUrl?: string; headers?: Record<string, string> }) => Promise<ProviderResult<{ instance: ProviderInstance }>>;
        update: (id: string, patch: Partial<Pick<ProviderInstance, "label" | "baseUrl" | "headers" | "enabled" | "pinnedModels" | "promptProfile" | "modelOverrides">>) => Promise<ProviderResult<{ instance: ProviderInstance }>>;
        remove: (id: string) => Promise<ProviderResult<object>>;
        /** Write-only: an empty key removes it and switches the provider off. */
        setKey: (id: string, apiKey: string) => Promise<ProviderResult<{ instance: ProviderInstance }>>;
        test: (id: string) => Promise<ProviderResult<{ count: number }>>;
        models: (id: string, options?: { refresh?: boolean }) => Promise<ProviderResult<{ models: ProviderModel[] }>>;
        /** Loopback only; run when the Providers page opens or on Scan, never in the background. */
        scan: () => Promise<ProviderResult<{ servers: DiscoveredServer[] }>>;
        /** Through the vendor's own runtime and page; resolves once the browser sign-in ends either way. */
        accountSignIn: (id: string) => Promise<ProviderResult<{ status: AccountStatus }>>;
        accountCancel: (id: string) => Promise<ProviderResult<object>>;
        /** Write-only: the code Google shows goes to the runtime's stdin; false when no sign-in is waiting for one. */
        accountSubmitCode: (id: string, code: string) => Promise<ProviderResult<{ accepted: boolean }>>;
        accountSignOut: (id: string) => Promise<ProviderResult<object>>;
        /** Never downloads the runtime: one not installed yet answers signed out. */
        accountStatus: (id: string) => Promise<ProviderResult<{ status: AccountStatus }>>;
        onAccountProgress: (callback: (progress: AccountProgress) => void) => Unsubscribe;
      };

      appInfo: () => Promise<AppInfo>;
      openLogs: () => Promise<string>;
      readLogs: (target: "debug" | "app" | "events", bytes?: number) => Promise<string>;
      getLogLevel: () => Promise<LogLevelState>;
      setLogLevel: (options: {
        level?: string;
        scopes?: string | string[];
        keep?: boolean;
        durationMs?: number;
      }) => Promise<LogLevelState>;
      diagnostics: {
        preview: (choices: DiagnosticsChoices) => Promise<{ name: string; size: number }[]>;
        export: (choices: DiagnosticsChoices) => Promise<{ saved: boolean; file?: string; bytes?: number; files?: number }>;
        crashNotice: () => Promise<{ show: boolean }>;
      };
      exportChat: (request: {
        defaultName: string;
        content: string;
        ext: "md" | "html";
      }) => Promise<{ saved: boolean; file?: string; bytes?: number }>;
      logEntry: (entry: LogEntry) => void;
      logBatch: (entries: LogEntry[]) => void;

      onDownloadProgress: (
        callback: (progress: DownloadProgressEvent) => void,
      ) => Unsubscribe;
      onBootModel: (callback: (model: string) => void) => Unsubscribe;
      /** The Settings page the splash handed over to, instead of a model. */
      onBootOpen?: (callback: (page: "providers") => void) => Unsubscribe;
      bootFinished: (model: string, open?: "providers") => void;
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

      sd?: {
        status: () => Promise<ImageEngineStatus>;
        configure: (options: { model: string; resolution?: string }) => Promise<{ success: boolean }>;
        setupEngine: () => Promise<{ success: boolean; runner?: string; kind?: string; error?: string }>;
        downloadRepo: (reference: string) => Promise<{ success: boolean; cancelled?: boolean; error?: string }>;
        cancelDownload: (id: string) => Promise<{ success: boolean }>;
        deleteModel: (id: string) => Promise<{ success: boolean; error?: string }>;
        generate: (request: ImageRequest) => Promise<ImageResult>;
        cancel: (requestId: string) => Promise<{ success: boolean }>;
        stop: () => Promise<{ success: boolean }>;
        onProgress: (callback: (progress: ImageProgress) => void) => Unsubscribe;
      };

      gguf?: {
        status: () => Promise<{
          running: boolean;
          port: number;
          model: string | null;
          contextSize: number;
          baseUrl: string;
          hasBinary: boolean;
          ready: boolean;
          runnerType?: string;
          engineBuild?: string | null;
          modelsDir?: string;
        }>;
        setupEngine: () => Promise<{ success: boolean; runnerType?: string; error?: string }>;
        start: (options: {
          modelPath: string;
          contextSize?: number;
          /** The window was fixed by the user: load exactly this, never rounded up. */
          exactContext?: boolean;
          gpuLayers?: number;
          port?: number;
        }) => Promise<{
          success: boolean;
          port?: number;
          error?: string;
          alreadyRunning?: boolean;
          /** The window the model is actually loaded at, which can exceed the one asked for. */
          contextSize?: number;
          /** The engine could not read the model's image projector, so the model runs without vision. */
          projectorRefused?: boolean;
          /** Which failure this is, so the reader is told in their own language. */
          kind?: string;
          params?: Record<string, string>;
        }>;
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
          /** From the chat template: tools and completion for all, thinking where the template has it. */
          capabilities?: string[];
        }[]>;
        deleteModel: (filename: string) => Promise<boolean>;
        downloadModel: (options: { url: string; filename: string; cid?: string }) => Promise<{
          success: boolean;
          path?: string;
          filename?: string;
          cancelled?: boolean;
        }>;
        cancelDownload: (filename: string) => Promise<{ success: boolean }>;
        onProgress: (callback: (progress: {
          phase: "preparing" | "downloading" | "done";
          completed: number;
          total: number;
          percent: number;
          remainingSeconds?: number | null;
          /** The file this event is for; downloads run side by side and share one channel. */
          label?: string;
        }) => void) => Unsubscribe;
        /** Where a wait has got to. Every figure is one the engine reported; the disk step has none. */
        onStage: (callback: (stage: { stage: "disk" | "loading" | "readying" | "reading"; percent?: number; tokensPerSecond?: number }) => void) => Unsubscribe;
      };
    };
  }
}
