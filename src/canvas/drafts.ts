/** Canvas bookkeeping for two authors editing one text. The editor is a textarea on purpose:
 * CodeMirror would add hundreds of kilobytes for little gain. */

export interface CanvasState {
  /** What is on disk, as far as the canvas last knew. */
  saved: string;
  /** What is in the editor. Differs from `saved` while there are changes. */
  draft: string;
  /** What landed on disk while the user had changes of their own. Kept aside rather than applied,
   * so neither author's work is silently thrown away. */
  conflict: string | null;
}

export function openState(text: string): CanvasState {
  return { saved: text, draft: text, conflict: null };
}

export function isDirty(state: CanvasState): boolean {
  return state.draft !== state.saved;
}

/** Something rewrote the file: usually the model, sometimes another program. With nothing unsaved
 * the editor simply follows; with unsaved changes the new text waits for the user to choose. */
export function onDiskChange(state: CanvasState, text: string): CanvasState {
  if (text === state.saved && state.conflict === null) return state;
  if (text === state.draft) return { saved: text, draft: text, conflict: null };
  if (!isDirty(state)) return openState(text);

  return { ...state, conflict: text };
}

/** Throws away the user's changes in favour of what is on disk now. */
export function takeTheirs(state: CanvasState): CanvasState {
  return state.conflict === null ? state : openState(state.conflict);
}

/** Keeps the user's changes. The disk version becomes the base they are measured against, so the
 * next save is what overwrites it, knowingly. */
export function keepMine(state: CanvasState): CanvasState {
  if (state.conflict === null) return state;
  return { saved: state.conflict, draft: state.draft, conflict: null };
}

export function afterSave(state: CanvasState, written: string): CanvasState {
  return { saved: written, draft: state.draft, conflict: null };
}

/** Whether two paths name the same file, allowing for Windows being Windows. */
export function samePath(a: string, b: string): boolean {
  const normalise = (value: string) => {
    const forward = String(value || "").replace(/\\/g, "/").replace(/\/+$/, "");
    return /^[a-z]:\//i.test(forward) ? forward.toLowerCase() : forward;
  };

  return normalise(a) === normalise(b);
}

export interface FileChange {
  workspaceId: string;
  path: string;
  /** Set when the file was moved: where it used to be. */
  from?: string;
}

/** What a change on disk means for the file the canvas has open: nothing, a new version of it, or
 * the same file under a new name. */
export function readChange(
  open: { workspaceId: string; path: string },
  change: FileChange,
): "none" | "changed" | "moved" {
  if (change.workspaceId && change.workspaceId !== open.workspaceId) return "none";
  if (change.from && samePath(change.from, open.path)) return "moved";
  if (samePath(change.path, open.path)) return "changed";
  return "none";
}

export function lineCount(text: string): number {
  if (!text) return 1;
  return text.split("\n").length;
}

const LANGUAGES: Record<string, string> = {
  ts: "TypeScript",
  mts: "TypeScript",
  cts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  jsx: "JavaScript",
  json: "JSON",
  jsonc: "JSON",
  md: "Markdown",
  markdown: "Markdown",
  mdx: "Markdown",
  py: "Python",
  pyw: "Python",
  rs: "Rust",
  go: "Go",
  java: "Java",
  kt: "Kotlin",
  kts: "Kotlin",
  scala: "Scala",
  cs: "C#",
  cpp: "C++",
  cc: "C++",
  cxx: "C++",
  hpp: "C++",
  c: "C",
  h: "C",
  css: "CSS",
  scss: "SCSS",
  sass: "SASS",
  less: "LESS",
  html: "HTML",
  htm: "HTML",
  xml: "XML",
  svg: "SVG",
  yml: "YAML",
  yaml: "YAML",
  toml: "TOML",
  ini: "INI",
  cfg: "Config",
  conf: "Config",
  sh: "Shell",
  bash: "Bash",
  zsh: "Zsh",
  ps1: "PowerShell",
  psm1: "PowerShell",
  psd1: "PowerShell",
  bat: "Batch",
  cmd: "Batch",
  sql: "SQL",
  php: "PHP",
  rb: "Ruby",
  swift: "Swift",
  dart: "Dart",
  lua: "Lua",
  r: "R",
  pl: "Perl",
  ex: "Elixir",
  exs: "Elixir",
  erl: "Erlang",
  hs: "Haskell",
  zig: "Zig",
  nim: "Nim",
  graphql: "GraphQL",
  gql: "GraphQL",
  dockerfile: "Docker",
  diff: "Diff",
  txt: "Text",
  png: "PNG Image",
  jpg: "JPEG Image",
  jpeg: "JPEG Image",
  jfif: "JPEG Image",
  gif: "GIF Image",
  webp: "WebP Image",
  ico: "Icon",
  cur: "Cursor",
  bmp: "Bitmap Image",
  avif: "AVIF Image",
  apng: "APNG Image",
  tiff: "TIFF Image",
  tif: "TIFF Image",
};

const PRISM_LANGUAGES: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  jsonc: "json",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  py: "python",
  pyw: "python",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  scala: "scala",
  cs: "csharp",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  c: "c",
  h: "c",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  html: "markup",
  htm: "markup",
  xml: "markup",
  svg: "markup",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  ps1: "powershell",
  psm1: "powershell",
  psd1: "powershell",
  bat: "batch",
  cmd: "batch",
  sql: "sql",
  php: "php",
  rb: "ruby",
  swift: "swift",
  dart: "dart",
  lua: "lua",
  r: "r",
  pl: "perl",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hs: "haskell",
  zig: "zig",
  nim: "nim",
  graphql: "graphql",
  gql: "graphql",
  dockerfile: "docker",
  diff: "diff",
};

export function languageOf(target: string): string {
  const name = String(target || "").split(/[\\/]/).pop() || "";
  const lower = name.toLowerCase();
  if (lower === "dockerfile") return "Docker";
  if (lower === "makefile") return "Makefile";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "Text";
  return LANGUAGES[name.slice(dot + 1).toLowerCase()] ?? "Text";
}

export function prismLanguageOf(target: string): string {
  const name = String(target || "").split(/[\\/]/).pop() || "";
  const lower = name.toLowerCase();
  if (lower === "dockerfile") return "docker";
  if (lower === "makefile") return "makefile";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "text";
  return PRISM_LANGUAGES[name.slice(dot + 1).toLowerCase()] ?? "text";
}

export function isCodeFile(target: string): boolean {
  const name = String(target || "").split(/[\\/]/).pop() || "";
  const lower = name.toLowerCase();
  if (lower === "dockerfile" || lower === "makefile") return true;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  const ext = name.slice(dot + 1).toLowerCase();
  return ext in PRISM_LANGUAGES && ext !== "txt" && ext !== "md" && ext !== "markdown" && ext !== "mdx";
}

export function isMarkdownFile(target: string): boolean {
  const name = String(target || "").split(/[\\/]/).pop() || "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  const ext = name.slice(dot + 1).toLowerCase();
  return ext === "md" || ext === "markdown" || ext === "mdx";
}

export const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "jfif",
  "gif",
  "webp",
  "svg",
  "ico",
  "cur",
  "bmp",
  "avif",
  "apng",
  "tiff",
  "tif",
]);

export function isImageFile(target: string): boolean {
  const name = String(target || "").split(/[\\/]/).pop() || "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  return IMAGE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

