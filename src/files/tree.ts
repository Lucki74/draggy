import type { DirectoryEntry } from "../types";

/**
 * Paths for the explorer, kept out of the components so they can be tested
 * without rendering anything. Everything here works on whichever separator the
 * platform handed back, since the main process answers in its own.
 */

export const SEPARATOR = /[\\/]/;

export function splitPath(target: string): string[] {
  return String(target).split(SEPARATOR).filter(Boolean);
}

/** The name of a file or folder, without the path to it. */
export function baseName(target: string): string {
  const parts = splitPath(target);
  return parts[parts.length - 1] || String(target);
}

/** The folder something is in. Empty when there is nothing above it. */
export function parentOf(target: string): string {
  const text = String(target).replace(/[\\/]+$/, "");
  const cut = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\"));
  return cut <= 0 ? "" : text.slice(0, cut);
}

/** Joins with the separator the path already uses, so Windows stays Windows. */
export function joinPath(base: string, name: string): string {
  if (!base) return name;
  const separator = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  return `${base.replace(/[\\/]+$/, "")}${separator}${name}`;
}

export function isInsideRoot(root: string, target: string): boolean {
  const normalise = (value: string) =>
    value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

  const from = normalise(root);
  const to = normalise(target);

  return to === from || to.startsWith(`${from}/`);
}

export interface Crumb {
  name: string;
  path: string;
}

/**
 * The trail from the project folder down to what is open. The first crumb is
 * the project itself, named after its folder rather than its whole path.
 */
export function breadcrumbs(root: string, target: string): Crumb[] {
  if (!root) return [];
  if (!target || !isInsideRoot(root, target)) {
    return [{ name: baseName(root), path: root }];
  }

  const rest = String(target)
    .slice(String(root).length)
    .split(SEPARATOR)
    .filter(Boolean);

  const crumbs: Crumb[] = [{ name: baseName(root), path: root }];
  let walked = root;

  for (const part of rest) {
    walked = joinPath(walked, part);
    crumbs.push({ name: part, path: walked });
  }

  return crumbs;
}

/** Folders first, then files, each alphabetically and ignoring case. */
export function sortEntries(entries: DirectoryEntry[]): DirectoryEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

/**
 * Generated and hidden things, folded away by default. The user can still ask
 * for them; this only decides what the tree opens with.
 */
const NOISE = new Set([
  "node_modules",
  "dist",
  "dist-electron",
  "build",
  "out",
  "target",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
]);

export function isNoise(name: string): boolean {
  return NOISE.has(name) || (name.startsWith(".") && name !== ".github");
}

export function partitionEntries(entries: DirectoryEntry[]): {
  shown: DirectoryEntry[];
  folded: DirectoryEntry[];
} {
  const sorted = sortEntries(entries);

  return {
    shown: sorted.filter((entry) => !isNoise(entry.name)),
    folded: sorted.filter((entry) => isNoise(entry.name)),
  };
}
