/** How a shell command is read for permissions: where one command ends and the next begins, and what
 * "always allow" remembers of it. A command that cannot be read safely is never covered by a grant. */

// Writing output to nowhere, or folding errors into output, changes nothing on disk.
const HARMLESS_REDIRECTS = /\s*\d?>\s*(&\d|\/dev\/null|\$null|nul)(?=\s|$)/gi;

/** Programs whose first word says nothing about what they will do: a grant for "python" would
 * allow any script, so a grant for one of these names the whole command instead. */
const INTERPRETERS = new Set([
  "python",
  "python3",
  "py",
  "node",
  "bun",
  "deno",
  "ruby",
  "perl",
  "php",
  "pwsh",
  "powershell",
  "cmd",
  "bash",
  "sh",
  "zsh",
  "npx",
  "uvx",
  "sudo",
  "env",
  "iex",
  "invoke-expression",
]);

/** The longest prefix kept, in words: "gh pr list" rather than "gh", which would allow merging. */
const PREFIX_WORDS = 3;

const normalise = (text: string) => text.trim().replace(/\s+/g, " ");

/** The separate commands in a command line, or null when it runs something no reader can see: a
 * substitution, a quote left open, or a redirect that writes a file. */
export function commandSegments(command: string | null | undefined): string[] | null {
  const text = String(command ?? "").replace(HARMLESS_REDIRECTS, " ").trim();
  if (!text) return null;

  if (/\$\(|`|<\(|>\(/.test(text)) return null;

  const segments: string[] = [];
  let current = "";
  let quote: string | null = null;

  const push = () => {
    const segment = normalise(current);
    if (segment) segments.push(segment);
    current = "";
  };

  for (const character of text) {
    if (quote) {
      current += character;
      if (character === quote) quote = null;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }

    if (character === ">" || character === "<") return null;

    if (character === ";" || character === "&" || character === "|" || character === "\n" || character === "\r") {
      push();
      continue;
    }

    current += character;
  }

  if (quote) return null;
  push();

  return segments.length > 0 ? segments : null;
}

/** What "always allow" keeps of one command: its leading words up to the first flag, or the whole
 * command when it starts with an interpreter. */
export function commandPrefix(segment: string): string {
  const words = normalise(segment).split(" ");
  if (INTERPRETERS.has(words[0].toLowerCase())) return normalise(segment);

  const kept: string[] = [];
  for (const word of words) {
    if (word.startsWith("-") || word.startsWith("/") && kept.length > 0) break;
    kept.push(word);
    if (kept.length === PREFIX_WORDS) break;
  }
  return kept.join(" ");
}

/** The prefixes "always allow" would store for a command line, one per command in it. Empty when
 * the line cannot be read safely, so nothing about it is remembered. */
export function commandGrantTargets(command: string | null | undefined): string[] {
  const segments = commandSegments(command);
  if (!segments) return [];
  return [...new Set(segments.map(commandPrefix))];
}

/** Whether every command in a line is one the user has already allowed. */
export function commandCovered(allowed: string[], command: string | null | undefined): boolean {
  const segments = commandSegments(command);
  if (!segments) return false;

  const prefixes = allowed.map(normalise).filter(Boolean);
  const matches = (segment: string, prefix: string) =>
    segment.toLowerCase() === prefix.toLowerCase() ||
    segment.toLowerCase().startsWith(`${prefix.toLowerCase()} `);

  return segments.every((segment) => prefixes.some((prefix) => matches(segment, prefix)));
}
