/**
 * The project's own instructions: an `AGENTS.md` at the root of the folder,
 * read into the system prompt every turn. The name is the one the rest of the
 * ecosystem settled on, so a repository that already has one works with Draggy
 * without anybody writing a second file.
 *
 * Folders deeper in may have their own, and the closest one wins, which is how
 * a monorepo says something different about one package.
 */

export const MEMORY_NAMES = ["AGENTS.md", "DRAGGY.md"];

/** How much of a memory file is worth carrying in every prompt. */
export const MAX_MEMORY_CHARS = 8000;

export interface ProjectMemory {
  /** Where it was found, relative to the project folder. */
  path: string;
  text: string;
}

function segmentsBetween(root: string, target: string): string[] {
  const normalise = (value: string) =>
    value.replace(/\\/g, "/").replace(/\/+$/, "");

  const from = normalise(root);
  const to = normalise(target);

  if (!to.toLowerCase().startsWith(from.toLowerCase())) return [];

  return to.slice(from.length).split("/").filter(Boolean);
}

/**
 * Every place a memory file could be for something being worked on, closest
 * first. The file's own folder, then each folder above it, ending at the root.
 */
export function memoryCandidates(root: string, target?: string): string[] {
  const folders: string[] = [""];

  if (target) {
    const parts = segmentsBetween(root, target);
    // The last part is the file itself, which is not a folder to look in.
    let walked = "";

    for (const part of parts.slice(0, -1)) {
      walked = walked ? `${walked}/${part}` : part;
      folders.push(walked);
    }
  }

  const candidates: string[] = [];

  // Deepest first: the closest file to the work is the one that wins.
  for (const folder of [...folders].reverse()) {
    for (const name of MEMORY_NAMES) {
      candidates.push(folder ? `${folder}/${name}` : name);
    }
  }

  return candidates;
}

/** Reads the first memory file that exists, closest to `target` first. */
export async function findMemory(
  read: (path: string) => Promise<string | null>,
  root: string,
  target?: string,
): Promise<ProjectMemory | null> {
  for (const candidate of memoryCandidates(root, target)) {
    const text = await read(candidate);
    if (text === null) continue;

    const trimmed = text.trim();
    if (!trimmed) continue;

    return { path: candidate, text: trimmed.slice(0, MAX_MEMORY_CHARS) };
  }

  return null;
}

/** What the system prompt says about it. */
export function renderMemory(memory: ProjectMemory): string {
  return `PROJECT INSTRUCTIONS (${memory.path})

The user keeps this file in the project for whoever works in it, and it outranks your own habits. Follow it. If it is wrong or out of date, say so rather than quietly doing something else.

${memory.text}`;
}

/** What a folder deeper in the project says, once something there is touched. */
export function renderFolderRules(memory: ProjectMemory): string {
  return `\n\nRULES FOR THIS FOLDER (${memory.path}):\n${memory.text}`;
}

export interface ProjectScan {
  /** The project folder's own name. */
  name: string;
  /** Top level entries, folders marked. */
  entries: { name: string; isDirectory: boolean }[];
  packageJson?: {
    name?: string;
    description?: string;
    scripts?: Record<string, string>;
  } | null;
}

/** The scripts worth writing down, in the order someone would run them. */
const SCRIPT_ORDER = [
  "install",
  "dev",
  "start",
  "build",
  "test",
  "check",
  "lint",
  "typecheck",
];

export function usefulScripts(
  scripts: Record<string, string> | undefined,
): string[] {
  if (!scripts) return [];

  const names = Object.keys(scripts);

  const ranked = names.slice().sort((a, b) => {
    const left = SCRIPT_ORDER.indexOf(a);
    const right = SCRIPT_ORDER.indexOf(b);
    if (left === right) return a.localeCompare(b);
    if (left === -1) return 1;
    if (right === -1) return -1;
    return left - right;
  });

  return ranked.slice(0, 6);
}

/** What the project looks like it is written in, from what is lying around. */
export function guessStack(scan: ProjectScan): string[] {
  const names = new Set(scan.entries.map((entry) => entry.name.toLowerCase()));
  const stack: string[] = [];

  if (names.has("package.json")) stack.push("Node");
  if (names.has("tsconfig.json")) stack.push("TypeScript");
  if (names.has("cargo.toml")) stack.push("Rust");
  if (names.has("go.mod")) stack.push("Go");
  if (names.has("pyproject.toml") || names.has("requirements.txt")) {
    stack.push("Python");
  }
  if (names.has("gemfile")) stack.push("Ruby");
  if (names.has("pom.xml") || names.has("build.gradle")) stack.push("Java");
  if (names.has("dockerfile")) stack.push("Docker");

  return stack;
}

/**
 * The first draft of a memory file. Deliberately written from what is actually
 * in the folder and nothing else: a file full of confident guesses would be
 * worse than no file, because the model would follow it.
 */
export function initialMemory(scan: ProjectScan): string {
  const title = scan.packageJson?.name || scan.name;
  const stack = guessStack(scan);
  const scripts = usefulScripts(scan.packageJson?.scripts);

  const folders = scan.entries
    .filter((entry) => entry.isDirectory && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .slice(0, 10);

  const lines: string[] = [`# ${title}`, ""];

  if (scan.packageJson?.description) {
    lines.push(scan.packageJson.description, "");
  } else {
    lines.push("<!-- One or two lines on what this project is. -->", "");
  }

  if (stack.length > 0) {
    lines.push(`Built with ${stack.join(", ")}.`, "");
  }

  if (scripts.length > 0) {
    lines.push("## Commands", "");
    lines.push("```bash");
    for (const script of scripts) lines.push(`npm run ${script}`);
    lines.push("```", "");
  }

  if (folders.length > 0) {
    lines.push("## Layout", "");
    for (const folder of folders) lines.push(`- \`${folder}/\``);
    lines.push("");
  }

  lines.push(
    "## House rules",
    "",
    "<!-- What Draggy should always do here, and what it should never do. -->",
    "",
  );

  return lines.join("\n");
}
