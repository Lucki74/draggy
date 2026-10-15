/** What "/image" was asked for. Flags come first or last; everything that is not a flag is the prompt. */
export interface ImageCommand {
  prompt: string;
  /** Code only: where in the project to save it. */
  to?: string;
  /** Code only: a picture in the project to start from. */
  from?: string;
  width?: number;
  height?: number;
  seed?: number;
  steps?: number;
  strength?: number;
  negative?: string;
  lora: string[];
  hires: boolean;
  overwrite: boolean;
}

export type ImageCommandError = { error: "empty" } | { error: "flag"; flag: string };

const VALUE_FLAGS = new Set(["to", "from", "size", "seed", "steps", "strength", "negative", "lora"]);
const SWITCHES = new Set(["hires", "overwrite"]);

/** Splits on spaces, keeping "quoted words" together so a path or a negative prompt can have spaces. */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) tokens.push(match[1] ?? match[2] ?? match[3]);
  return tokens;
}

export function parseImageCommand(argument: string): ImageCommand | ImageCommandError {
  const tokens = tokenize(String(argument || "").trim());
  const command: ImageCommand = { prompt: "", lora: [], hires: false, overwrite: false };
  const words: string[] = [];

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!token.startsWith("--") || token.length < 3) {
      words.push(token);
      continue;
    }

    const flag = token.slice(2).toLowerCase();
    if (SWITCHES.has(flag)) {
      if (flag === "hires") command.hires = true;
      else command.overwrite = true;
      continue;
    }
    if (!VALUE_FLAGS.has(flag) || index + 1 >= tokens.length) return { error: "flag", flag: token };

    const value = tokens[++index];
    if (flag === "to") command.to = value;
    else if (flag === "from") command.from = value;
    else if (flag === "negative") command.negative = value;
    else if (flag === "lora") command.lora.push(value);
    else if (flag === "size") {
      const size = /^(\d{2,4})x(\d{2,4})$/i.exec(value);
      if (!size) return { error: "flag", flag: `${token} ${value}` };
      command.width = Number(size[1]);
      command.height = Number(size[2]);
    } else {
      const number = Number(value);
      if (!Number.isFinite(number)) return { error: "flag", flag: `${token} ${value}` };
      if (flag === "seed") command.seed = Math.trunc(number);
      else if (flag === "steps") command.steps = Math.trunc(number);
      else command.strength = number;
    }
  }

  command.prompt = words.join(" ").trim();
  if (!command.prompt) return { error: "empty" };
  return command;
}

/** A file name from a prompt, the same way the main process names one in the output folder. */
export function slugFor(prompt: string): string {
  const words = String(prompt || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let slug = "";
  for (const word of words) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > 40) break;
    slug = next;
  }
  return slug || "image";
}

/** Where an image goes in a project when nobody said where. */
export function defaultProjectPath(prompt: string): string {
  return `assets/generated/${slugFor(prompt)}.png`;
}
