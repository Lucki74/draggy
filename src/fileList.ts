/**
 * Pure helpers for the created-files list, kept out of the component so they
 * can be tested without rendering anything.
 */

export const CODE_EXTENSIONS = new Set([
  "js", "jsx", "ts", "tsx", "py", "html", "css", "scss", "json", "yml", "yaml",
  "sh", "bash", "ps1", "cpp", "c", "h", "cs", "rs", "go", "java", "rb", "php",
  "sql", "toml", "xml", "swift", "kt", "lua", "r",
]);

export const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg",
]);

export const SHEET_EXTENSIONS = new Set(["xlsx", "xls", "csv", "tsv"]);
export const SLIDE_EXTENSIONS = new Set(["pptx", "ppt"]);
export const DOC_EXTENSIONS = new Set(["docx", "doc", "md", "txt", "rtf", "pdf"]);

export type FileKind = "code" | "image" | "sheet" | "slides" | "document" | "other";

export function kindOf(extension: string): FileKind {
  const clean = extension.replace(/^\./, "").toLowerCase();
  if (CODE_EXTENSIONS.has(clean)) return "code";
  if (IMAGE_EXTENSIONS.has(clean)) return "image";
  if (SHEET_EXTENSIONS.has(clean)) return "sheet";
  if (SLIDE_EXTENSIONS.has(clean)) return "slides";
  if (DOC_EXTENSIONS.has(clean)) return "document";
  return "other";
}

const KILOBYTE = 1024;
const MEGABYTE = KILOBYTE * 1024;

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < KILOBYTE) return `${bytes} B`;
  if (bytes < MEGABYTE) return `${(bytes / KILOBYTE).toFixed(1)} KB`;
  return `${(bytes / MEGABYTE).toFixed(1)} MB`;
}

export type FileGroup = "today" | "yesterday" | "thisWeek" | "earlier";

export const FILE_GROUPS: FileGroup[] = [
  "today",
  "yesterday",
  "thisWeek",
  "earlier",
];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Buckets a file by calendar day rather than by elapsed hours, so something
 * written last night reads as "yesterday" and not as "today" until noon.
 */
export function groupFor(modified: number, now: number): FileGroup {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);

  if (modified >= startOfToday) return "today";
  if (modified >= startOfToday - DAY_MS) return "yesterday";
  if (modified >= startOfToday - 6 * DAY_MS) return "thisWeek";
  return "earlier";
}

export interface GroupedFiles<T> {
  group: FileGroup;
  files: T[];
}

export function groupFiles<T extends { modified: number }>(
  files: T[],
  now: number,
): GroupedFiles<T>[] {
  const buckets = new Map<FileGroup, T[]>();

  for (const file of files) {
    const group = groupFor(file.modified, now);
    const list = buckets.get(group);
    if (list) list.push(file);
    else buckets.set(group, [file]);
  }

  return FILE_GROUPS.filter((group) => buckets.has(group)).map((group) => ({
    group,
    files: buckets.get(group) as T[],
  }));
}

export function matchesQuery(name: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return name.toLowerCase().includes(needle);
}
