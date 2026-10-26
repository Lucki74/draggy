/** How a shell command is read for permissions: where one command ends and the next begins, and what
 * "always allow" remembers of it. A command that cannot be read safely is never covered by a grant. */

/** The three grammars a command can be written in. Each reads quoting, grouping and redirects its own way. */
export type ShellDialect = "bash" | "pwsh" | "cmd";

/** The grammar for a shell name; an unknown or missing name reads as the strictest one. */
export function dialectFor(shell: string | null | undefined): ShellDialect {
  const name = String(shell ?? "").toLowerCase();
  if (name === "bash" || name === "sh" || name === "zsh") return "bash";
  if (name === "cmd") return "cmd";
  return "pwsh";
}

// Writing output to nowhere, or folding errors into output, changes nothing on disk. In PowerShell
// "/dev/null" is a real path on the current drive, and in bash "$null" is an empty variable.
const HARMLESS_REDIRECTS: Record<ShellDialect, RegExp> = {
  bash: /\s*(?:\d|&)?>\s*(?:&\d|\/dev\/null)(?=\s|$)/g,
  pwsh: /\s*(?:\d|\*)?>\s*(?:&\d|\$null|nul)(?=\s|$)/gi,
  cmd: /\s*\d?>\s*(?:&\d|nul)(?=\s|$)/gi,
};

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
  "wsl",
  "npx",
  "uvx",
  "sudo",
  "env",
  "eval",
  "exec",
  "source",
  "xargs",
  "nohup",
  "timeout",
  "iex",
  "invoke-expression",
  "invoke-command",
  "icm",
  "invoke-item",
  "ii",
  "start-process",
  "saps",
  "start",
  "start-job",
  "sajb",
]);

/** Global git options that take a value before the subcommand, as in "git -C dir push". */
const GIT_VALUE_OPTIONS = new Set(["-c", "-C", "--git-dir", "--work-tree", "--namespace", "--exec-path"]);
const GIT_FLAG_OPTIONS = new Set(["--no-pager", "-P", "--paginate", "-p", "--bare", "--no-optional-locks"]);

/** The longest prefix kept, in words: "gh pr list" rather than "gh", which would allow merging. */
const PREFIX_WORDS = 3;

const normalise = (text: string) => text.trim().replace(/\s+/g, " ");

/** The text with the inside of quotes blanked, for checks on syntax that quoting makes plain text. */
function unquoted(text: string): string {
  return text.replace(/"(?:\\.|[^"\\])*"|'[^']*'/g, '""');
}

/** Whether the line holds something no reader of the text can follow in this grammar. */
function opaque(text: string, dialect: ShellDialect): boolean {
  // Substitutions and process substitutions run a command the text never shows.
  if (/\$\(|`|<\(|>\(/.test(text)) return true;

  if (dialect === "bash") {
    // Subshells, groups and here documents hide or defer commands; "${" and "$((" expand arbitrarily.
    return /[(){}]|<<|\$\{/.test(unquoted(text)) || /\$\{/.test(text);
  }

  if (dialect === "pwsh") {
    // Script blocks, sub-expressions, array and hash literals, block comments, the call operator,
    // dot sourcing and the stop-parsing token all run text the splitter cannot see.
    return /[(){}]|<#|#>|--%/.test(unquoted(text));
  }

  // cmd expands %VAR% and ^ escapes before it parses, so neither can be read from the text.
  return /[%^]/.test(text) || /[(){}]/.test(unquoted(text));
}

/** The separate commands in a command line, or null when it runs something no reader can see: a
 * substitution, a quote left open, a redirect that writes a file or a construct of the dialect. */
export function commandSegments(
  command: string | null | undefined,
  dialect: ShellDialect = "bash",
): string[] | null {
  const text = String(command ?? "").replace(HARMLESS_REDIRECTS[dialect], " ").trim();
  if (!text) return null;
  if (opaque(text, dialect)) return null;

  const segments: string[] = [];
  let current = "";
  let quote: string | null = null;

  const push = () => {
    const segment = normalise(current);
    if (segment) segments.push(segment);
    current = "";
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (quote) {
      current += character;
      // Bash lets a backslash protect a quote inside double quotes; PowerShell uses a backtick, which
      // is already refused above.
      if (quote === '"' && dialect === "bash" && character === "\\" && index + 1 < text.length) {
        index += 1;
        current += text[index];
        continue;
      }
      if (character === quote) quote = null;
      continue;
    }

    if (dialect === "bash" && character === "\\") {
      // A protected character is text, not syntax; a trailing backslash joins lines, so it is unreadable.
      if (index + 1 >= text.length) return null;
      index += 1;
      current += `\\${text[index]}`;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }

    if (character === ">" || character === "<") return null;

    if (character === "&") {
      // "&&" chains in bash, cmd and PowerShell 7. A lone "&" backgrounds in bash and runs a command
      // in cmd; in PowerShell it is the call operator, which runs whatever follows it.
      if (text[index + 1] === "&") {
        index += 1;
        push();
        continue;
      }
      if (dialect === "pwsh" || dialect === "cmd") return null;
      push();
      continue;
    }

    if (character === ";" || character === "|" || character === "\n" || character === "\r") {
      push();
      continue;
    }

    current += character;
  }

  if (quote) return null;
  push();

  if (segments.length === 0) return null;

  for (const segment of segments) {
    const first = segment.split(" ")[0];
    // A command named by a variable or a dot-sourced script is unknown until it runs.
    if (first.startsWith("$") || first.startsWith("\\$")) return null;
    if (dialect !== "cmd" && first === ".") return null;
    if (dialect === "bash" && first === "!") return null;
  }

  return segments;
}

/** The index where a git command's subcommand starts, after global options such as "-C dir". */
function gitSubcommandStart(words: string[]): number {
  let start = 1;
  while (start < words.length) {
    const word = words[start];
    if (GIT_FLAG_OPTIONS.has(word)) start += 1;
    else if (GIT_VALUE_OPTIONS.has(word)) start += 2;
    else if (GIT_VALUE_OPTIONS.has(word.split("=")[0]) && word.includes("=")) start += 1;
    else break;
  }
  return start;
}

/** A command with git's global options removed, so a grant for "git push" covers "git -C dir push". */
function canonical(segment: string): string {
  const words = segment.split(" ");
  if (words[0].toLowerCase() !== "git") return segment;
  const start = gitSubcommandStart(words);
  return start >= words.length ? segment : ["git", ...words.slice(start)].join(" ");
}

/** What "always allow" keeps of one command: its leading words up to the first flag, or the whole
 * command when it starts with an interpreter. */
export function commandPrefix(segment: string): string {
  const words = normalise(segment).split(" ");
  if (INTERPRETERS.has(words[0].toLowerCase())) return normalise(segment);

  let start = 0;
  if (words[0].toLowerCase() === "git") {
    // "git -C dir push --force" is a push; a grant must not become one for every git command.
    start = gitSubcommandStart(words);
    if (start >= words.length) return normalise(segment);
  }

  const kept: string[] = [words[0]];
  for (const word of words.slice(start === 0 ? 1 : start)) {
    if (word.startsWith("-") || (word.startsWith("/") && kept.length > 0)) break;
    kept.push(word);
    if (kept.length === PREFIX_WORDS) break;
  }
  return kept.join(" ");
}

/** The prefixes "always allow" would store for a command line, one per command in it. Empty when
 * the line cannot be read safely, so nothing about it is remembered. */
export function commandGrantTargets(
  command: string | null | undefined,
  dialect: ShellDialect = "bash",
): string[] {
  const segments = commandSegments(command, dialect);
  if (!segments) return [];
  return [...new Set(segments.map(commandPrefix))];
}

/** Whether every command in a line is one the user has already allowed. */
export function commandCovered(
  allowed: string[],
  command: string | null | undefined,
  dialect: ShellDialect = "bash",
): boolean {
  const segments = commandSegments(command, dialect);
  if (!segments) return false;

  const prefixes = allowed.map(normalise).filter(Boolean);
  const matches = (segment: string, prefix: string) => {
    const text = canonical(segment).toLowerCase();
    return text === prefix.toLowerCase() || text.startsWith(`${prefix.toLowerCase()} `);
  };

  return segments.every((segment) => prefixes.some((prefix) => matches(segment, prefix)));
}
