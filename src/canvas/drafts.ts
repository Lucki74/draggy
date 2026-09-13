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
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  json: "JSON",
  md: "Markdown",
  py: "Python",
  rs: "Rust",
  go: "Go",
  java: "Java",
  cs: "C#",
  cpp: "C++",
  c: "C",
  h: "C",
  css: "CSS",
  html: "HTML",
  yml: "YAML",
  yaml: "YAML",
  toml: "TOML",
  sh: "Shell",
  ps1: "PowerShell",
  sql: "SQL",
  txt: "Text",
};

export function languageOf(target: string): string {
  const name = String(target || "").split(/[\\/]/).pop() || "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "Text";
  return LANGUAGES[name.slice(dot + 1).toLowerCase()] ?? "Text";
}
