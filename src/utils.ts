export const generateId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 15);
};

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\uFFFD]/;

export const isBinary = (str: string): boolean => {
  if (!str) return false;
  if (str.startsWith("data:")) return false;
  if (CONTROL_CHARS_RE.test(str)) return true;
  if (str.length > 50) {
    let nonAscii = 0;
    for (let i = 0; i < str.length; i++) {
      if (str.charCodeAt(i) > 127) nonAscii++;
    }
    if (nonAscii > str.length * 0.2) return true;
  }
  return false;
};

export function sanitizeContent(content: string): string {
  if (isBinary(content)) {
    return "[File content or binary data detected and hidden for clarity]";
  }
  return content;
}

export function normalizeMath(content: string): string {
  return content
    .replace(/\\\[/g, "$$")
    .replace(/\\\]/g, "$$")
    .replace(/\\\(/g, "$")
    .replace(/\\\)/g, "$");
}

export interface FileProgressEvent {
  file?: string;
  loaded?: number;
  total?: number;
}

/**
 * One figure for a multi-file download. Per-file counts make a tokenizer hit
 * 100% then fall back to nought, so files are summed by name instead.
 */
export function createFileProgressTracker(): (event: FileProgressEvent) => number {
  const files = new Map<string, { loaded: number; total: number }>();
  let total = 0;
  let percent = 0;

  return (event) => {
    const fileTotal = event.total || 0;
    if (fileTotal <= 0) return percent;

    const key = event.file || "";
    const seen = files.get(key);
    files.set(key, {
      total: fileTotal,
      // Events can repeat for the same file; a file never un-downloads.
      loaded: Math.max(seen?.loaded ?? 0, event.loaded || 0),
    });

    const previousTotal = total;
    let loaded = 0;
    total = 0;
    for (const file of files.values()) {
      loaded += file.loaded;
      total += file.total;
    }

    const measured = total > 0 ? (loaded / total) * 100 : 0;
    // A newly discovered file makes the job bigger, so going back is honest.
    // While the job stays the same size the figure only ever grows.
    percent = total === previousTotal ? Math.max(percent, measured) : measured;
    return percent;
  };
}

export function safeJsonParse<T = unknown>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function writeLocalStorage(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/**
 * The part of a hostname a person would actually name it by: "bbc" for
 * "www.bbc.co.uk". Used for the little site badge on a search result.
 */
export function siteLabel(hostname: string): string {
  const clean = hostname.replace(/^www\./i, "").toLowerCase();
  if (!clean) return "?";

  const parts = clean.split(".").filter(Boolean);
  if (parts.length === 0) return "?";

  // Drop the public suffix, including two-part ones such as .co.uk.
  const SHORT_SUFFIXES = new Set(["co", "com", "org", "net", "gov", "ac", "edu"]);
  let name = parts[0];
  if (parts.length > 2 && SHORT_SUFFIXES.has(parts[parts.length - 2])) {
    name = parts[parts.length - 3];
  } else if (parts.length > 1) {
    name = parts[parts.length - 2];
  }

  return name || clean;
}

/**
 * A stable colour for a site badge, derived from the name. Fetching favicons
 * from Google announced every domain the user looked at, and was blocked.
 */
export function hueFor(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) % 360000;
  }
  return hash % 360;
}

/** How much of the first message is used to name a chat. */
export const TITLE_LENGTH = 40;

/**
 * Names a chat after the message that started it. Asking a model was slow and
 * sometimes titled the chat with its own refusal; a wrong title is worse.
 */
export function titleFromContent(content: string, fallback: string): string {
  const trimmed = content.trim().replace(/\s+/g, " ");
  if (!trimmed) return fallback;

  if (trimmed.length <= TITLE_LENGTH) return trimmed;

  // Prefer to stop at a word boundary rather than mid-word.
  const cut = trimmed.slice(0, TITLE_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  const head = lastSpace > TITLE_LENGTH / 2 ? cut.slice(0, lastSpace) : cut;

  return head.trimEnd() + "...";
}
