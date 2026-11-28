import { logRendererEvent, swallowed } from "../logger";

/** A compact symbol map of the project folder. Built from the file bridge and regex, not a parser.
 * The file watcher marks changed files dirty; a long safety TTL covers missed events. */

export interface RepoSymbol {
  path: string;
  line: number;
  kind: string;
  name: string;
}

export interface RepoMap {
  builtAt: number;
  files: number;
  symbols: RepoSymbol[];
  truncated: boolean;
  /** Why the map is partial, for the tool output. Empty when complete. */
  reasons: string[];
}

export const REPO_MAP_SAFETY_TTL_MS = 10 * 60_000;
export const REPO_MAP_MAX_FILES = 2000;
export const REPO_MAP_MAX_DEPTH = 6;
export const REPO_MAP_MAX_FILE_BYTES = 200 * 1024;
export const REPO_MAP_MAX_SYMBOLS = 4000;
const DIRTY_FULL_REBUILD = 200;
const READ_BATCH = 8;
const MAX_LINE_CHARS = 2000;

const SKIP_DIRS = new Set(["node_modules", "target", "dist", "build", "vendor", "out", "__pycache__"]);
const SOURCE_EXT = /\.(tsx?|jsx?|mjs|cjs|rs|py|go)$/i;
const GENERATED = /(\.min\.[cm]?js|\.d\.ts|\.generated\.[^/]+)$/i;

type IgnoreMatcher = (path: string, isDirectory: boolean) => boolean;

interface Index {
  builtAt: number;
  files: Map<string, RepoSymbol[]>;
  ignore: IgnoreMatcher;
  dirty: Set<string>;
  dirtyAll: boolean;
  reasons: string[];
  built?: RepoMap;
  unsubscribe?: () => void;
}

const indexes = new Map<string, Index>();
const inflight = new Map<string, Promise<RepoMap>>();

const escapeRegex = (text: string): string => text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
const norm = (path: string): string => path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");

/** Turns one gitignore glob into a regex: ** across folders, * and ? within one name, [..] classes. */
function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      const slash = glob[i + 2] === "/";
      out += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else if (c === "[" && glob.indexOf("]", i) > i) {
      const end = glob.indexOf("]", i);
      out += glob.slice(i, end + 1).replace(/^\[!/, "[^");
      i = end;
    } else out += escapeRegex(c);
  }
  return new RegExp("^" + out + "$");
}

/** Compiles the root .gitignore: negation with !, dir/ suffixes, anchored and nested globs. Last match wins. */
export function parseIgnore(text: string): IgnoreMatcher {
  const rules = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const negate = line.startsWith("!");
      const raw = negate ? line.slice(1) : line;
      const dirOnly = raw.endsWith("/");
      const body = raw.replace(/\/+$/, "").replace(/^\/+/, "");
      return { negate, dirOnly, anchored: raw.replace(/\/+$/, "").includes("/"), pattern: globToRegExp(body) };
    });

  const matchOne = (full: string, isDirectory: boolean): boolean => {
    const base = full.split("/").pop() ?? full;
    let ignored = false;
    for (const rule of rules) {
      if (rule.dirOnly && !isDirectory) continue;
      if (rule.pattern.test(rule.anchored ? full : base)) ignored = !rule.negate;
    }
    return ignored;
  };

  return (path, isDirectory) => {
    const parts = norm(path).split("/");
    for (let i = 1; i < parts.length; i++) {
      if (matchOne(parts.slice(0, i).join("/"), true)) return true;
    }
    return matchOne(parts.join("/"), isDirectory);
  };
}

/** Pulls top-level declarations out of one file. Lines are 1-based. */
export function extractSymbols(path: string, text: string): RepoSymbol[] {
  const rules: Array<[RegExp, string]> = /\.rs$/i.test(path)
    ? [
        [/^\s*pub(?:\([^)]*\))?\s+(?:async\s+)?(?:const\s+)?(?:unsafe\s+)?fn\s+(\w+)/, "fn"],
        [/^\s*pub(?:\([^)]*\))?\s+(struct|enum|trait|type|mod)\s+(\w+)/, "$1"],
      ]
    : /\.py$/i.test(path)
      ? [
          [/^(?:async\s+)?def\s+(\w+)/, "def"],
          [/^class\s+(\w+)/, "class"],
        ]
      : /\.go$/i.test(path)
        ? [
            [/^func\s+(?:\([^)]*\)\s*)?(\w+)/, "func"],
            [/^type\s+(\w+)\s+(?:struct|interface)/, "type"],
          ]
        : [
            [/^export\s+(?:default\s+)?(?:async\s+)?function\*?\s+(\w+)/, "function"],
            [/^export\s+(?:abstract\s+)?class\s+(\w+)/, "class"],
            [/^export\s+(?:interface|type|enum)\s+(\w+)/, "type"],
            [/^export\s+const\s+(\w+)/, "const"],
          ];

  const symbols: RepoSymbol[] = [];
  text.split("\n").forEach((line, index) => {
    for (const [pattern, kind] of rules) {
      const match = pattern.exec(line);
      if (!match) continue;
      const name = match[match.length - 1];
      const resolved = kind.startsWith("$") ? match[1] : kind;
      symbols.push({ path, line: index + 1, kind: resolved, name });
      return;
    }
  });
  return symbols;
}

const skipDir = (name: string): boolean => name.startsWith(".") || SKIP_DIRS.has(name);

/** Whether a path is a source file the map tracks. The watcher and the refresh both use it. */
function tracked(index: Index, path: string): boolean {
  if (!SOURCE_EXT.test(path) || GENERATED.test(path)) return false;
  return !path.split("/").slice(0, -1).some(skipDir) && !index.ignore(path, false);
}

/** Lists the folder through the file bridge, down to the depth and file caps. */
async function walk(workspaceId: string): Promise<{ paths: string[]; ignore: IgnoreMatcher; reasons: string[] }> {
  const api = window.draggy?.files;
  const paths: string[] = [];
  const reasons = new Set<string>();

  const rootIgnore = await api?.read(workspaceId, ".gitignore")
    .catch(swallowed("project", "the main process already logged this call"));
  const ignore = parseIgnore(rootIgnore?.success ? (rootIgnore.text ?? "") : "");

  const visit = async (dir: string, depth: number): Promise<void> => {
    if (paths.length >= REPO_MAP_MAX_FILES) return;
    if (depth > REPO_MAP_MAX_DEPTH) {
      reasons.add(`folders deeper than ${REPO_MAP_MAX_DEPTH} levels`);
      return;
    }
    const listing = await api?.list(workspaceId, dir || ".")
      .catch(swallowed("project", "the main process already logged this call"));
    for (const entry of listing?.entries ?? []) {
      if (paths.length >= REPO_MAP_MAX_FILES) {
        reasons.add(`more than ${REPO_MAP_MAX_FILES} files`);
        return;
      }
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        if (skipDir(entry.name) || ignore(rel, true)) continue;
        await visit(rel, depth + 1);
      } else if (SOURCE_EXT.test(entry.name) && !GENERATED.test(entry.name) && !ignore(rel, false)) {
        if (entry.size > REPO_MAP_MAX_FILE_BYTES) reasons.add("files over 200 KB");
        else paths.push(rel);
      }
    }
  };

  await visit("", 0);
  return { paths, ignore, reasons: [...reasons] };
}

/** Reads files a few at a time so the renderer thread yields between batches. */
async function readBatch<T>(paths: string[], task: (path: string) => Promise<T>): Promise<Array<[string, T]>> {
  const out: Array<[string, T]> = [];
  for (let i = 0; i < paths.length; i += READ_BATCH) {
    const batch = paths.slice(i, i + READ_BATCH);
    const results = await Promise.all(batch.map(async (path) => [path, await task(path)] as [string, T]));
    out.push(...results);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return out;
}

/** Reads one file and extracts its symbols. Null means it is not part of the map. */
async function readSymbols(workspaceId: string, path: string): Promise<RepoSymbol[] | null> {
  const read = await window.draggy?.files?.read(workspaceId, path)
    .catch(swallowed("project", "the main process already logged this call"));
  if (!read?.success || typeof read.text !== "string") return null;
  if ((read.bytes ?? read.text.length) > REPO_MAP_MAX_FILE_BYTES) return null;
  // A minified bundle has no useful top-level lines.
  if (read.text.split("\n").some((line) => line.length > MAX_LINE_CHARS)) return null;
  return extractSymbols(path, read.text);
}

/** Watcher events only mark paths dirty. The next tool call re-reads them. */
function onChange(index: Index, change: { path: string; from?: string }): void {
  const path = norm(change.path);
  index.built = undefined;
  if (path === ".gitignore") {
    index.dirtyAll = true;
    return;
  }
  index.dirty.add(path);
  if (change.from) index.dirty.add(norm(change.from));
  if (index.dirty.size > DIRTY_FULL_REBUILD) index.dirtyAll = true;
}

async function buildFull(workspaceId: string): Promise<Index> {
  indexes.get(workspaceId)?.unsubscribe?.();
  const { paths, ignore, reasons } = await walk(workspaceId);
  const index: Index = { builtAt: Date.now(), files: new Map(), ignore, dirty: new Set(), dirtyAll: false, reasons };

  for (const [path, symbols] of await readBatch(paths, (p) => readSymbols(workspaceId, p))) {
    if (symbols) index.files.set(path, symbols);
  }

  const on = window.draggy?.files?.onChanged;
  if (on) {
    index.unsubscribe = on((change) => {
      if (change.workspaceId === workspaceId) onChange(index, change);
    });
  }
  indexes.set(workspaceId, index);
  return index;
}

/** Re-reads only the dirty paths. A path that is gone, untracked or unreadable leaves the map. */
async function refreshDirty(workspaceId: string, index: Index): Promise<void> {
  const paths = [...index.dirty];
  index.dirty.clear();
  const results = await readBatch(paths, (p) => (tracked(index, p) ? readSymbols(workspaceId, p) : Promise.resolve(null)));
  for (const [path, symbols] of results) {
    if (symbols) index.files.set(path, symbols);
    else index.files.delete(path);
  }
}

function flatten(index: Index): RepoMap {
  const symbols: RepoSymbol[] = [];
  for (const path of [...index.files.keys()].sort()) symbols.push(...(index.files.get(path) ?? []));
  const reasons = [...index.reasons];
  if (symbols.length > REPO_MAP_MAX_SYMBOLS) reasons.push(`more than ${REPO_MAP_MAX_SYMBOLS} symbols`);
  return {
    builtAt: index.builtAt,
    files: index.files.size,
    symbols: symbols.slice(0, REPO_MAP_MAX_SYMBOLS),
    truncated: reasons.length > 0,
    reasons,
  };
}

/** Returns the map. Concurrent callers share one load, so a burst of tool calls walks the folder once. */
export function getRepoMap(workspaceId: string, force = false): Promise<RepoMap> {
  const pending = inflight.get(workspaceId);
  if (pending && !force) return pending;
  const load = loadRepoMap(workspaceId, force).finally(() => inflight.delete(workspaceId));
  inflight.set(workspaceId, load);
  return load;
}

/** Rebuilds fully when stale, refreshes only dirty files otherwise. */
async function loadRepoMap(workspaceId: string, force: boolean): Promise<RepoMap> {
  const started = performance.now();
  const existing = indexes.get(workspaceId);
  const stale = !existing || force || existing.dirtyAll || Date.now() - existing.builtAt > REPO_MAP_SAFETY_TTL_MS;

  if (!stale && existing?.built) return existing.built;
  if (stale) {
    existing?.unsubscribe?.();
    indexes.delete(workspaceId);
  }
  const index = stale ? await buildFull(workspaceId) : existing;
  if (!index) return { builtAt: Date.now(), files: 0, symbols: [], truncated: false, reasons: [] };
  if (!stale) {
    await refreshDirty(workspaceId, index);
    index.dirtyAll = false;
  }

  index.built = flatten(index);
  logRendererEvent("project.repoMap", "DEBUG", "repo map ready", {
    files: index.built.files,
    symbols: index.built.symbols.length,
    full: stale,
    durMs: Math.round(performance.now() - started),
  }, null);
  return index.built;
}

/** Renders map rows matching the query, capped at maxLines. Empty query returns the top of the map. */
export function queryRepoMap(map: RepoMap, query: string, maxLines = 120): string {
  const needle = query.trim().toLowerCase();
  // Exact name first, then prefix, then substring; ties keep path order.
  const rank = (s: RepoSymbol): number => {
    const name = s.name.toLowerCase();
    if (!needle || name === needle) return 0;
    return name.startsWith(needle) ? 1 : 2;
  };
  const hits = map.symbols
    .filter((s) => !needle || s.name.toLowerCase().includes(needle) || s.path.toLowerCase().includes(needle))
    .sort((a, b) => rank(a) - rank(b));
  const note = map.truncated ? `\nMap is partial: ${(map.reasons ?? []).join("; ") || "limit reached"}. Narrow the query or open a deeper folder.` : "";
  if (hits.length === 0) {
    return (needle ? `No symbol matches "${query}" in ${map.files} files.` : "The map is empty.") + note;
  }
  const rows = hits.map((s) => `${s.path}:${s.line} ${s.kind} ${s.name}`);
  const shown = rows.slice(0, maxLines);
  const more = rows.length > shown.length ? `\n... ${rows.length - shown.length} more, narrow the query.` : "";
  return shown.join("\n") + more + note;
}

/** Drops one workspace's index and its watcher subscription. */
export function disposeRepoMap(workspaceId: string): void {
  indexes.get(workspaceId)?.unsubscribe?.();
  indexes.delete(workspaceId);
}

/** Test hook: drops every index. */
export function clearRepoMapCache(): void {
  for (const id of [...indexes.keys()]) disposeRepoMap(id);
}
