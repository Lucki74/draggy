import { safeJsonParse } from "./utils";
import { allToolNames, onRegistryChange } from "./tools/registry";

export const TOOL_MARKER_RE = /<tool|<function|<invoke|<search_|<read_|<run_|<browser_|<create_|"name"/i;
export const TOOL_MARKER_OVERLAP = 16;

export const MAX_TOOL_LOOPS = 75;
export const STREAM_UI_INTERVAL_MS = 50;

const TOOL_TAG_RE =
  /<(?:tool|tool_call|function|invoke)>([\s\S]*?)<\/(?:tool|tool_call|function|invoke)>/i;

const REACT_TOOL_RE = /<tool\s+([a-zA-Z0-9_]+)\s*=\s*(\{[\s\S]*?\})\s*\/?>?/i;

const THINK_CLOSED_RE = /<think>([\s\S]*?)<\/think>/i;
const THINK_OPEN_RE = /<think>([\s\S]*)$/i;

const FENCED_BLOCK_RE = /```[\s\S]*?(?:```|$)/g;
const INLINE_CODE_RE = /`[^`\n]*`/g;

const FUNCTION_ENVELOPE_RE =
  /\{\s*"type"\s*:\s*"function"[\s\S]*?(?:\}\s*)+/gi;

const TOOL_CALLS_ENVELOPE_RE =
  /\{\s*"tool_calls"\s*:[\s\S]*?(?:\}\s*)+/gi;

const ORPHAN_BRACE_LINE_RE = /(?:^|\n)[ \t]*[{}[\]]+[ \t]*(?=\n|$)/g;

function protectCode(text: string): { masked: string; restore: (value: string) => string } {
  const stored: string[] = [];

  const mask = (match: string) => {
    stored.push(match);
    return `__DRAGGY_CODE_${stored.length - 1}__`;
  };

  const masked = text.replace(FENCED_BLOCK_RE, mask).replace(INLINE_CODE_RE, mask);

  return {
    masked,
    restore: (value) =>
      value.replace(
        /__DRAGGY_CODE_(\d+)__/g,
        (whole, index) => stored[Number(index)] ?? whole,
      ),
  };
}

export interface ToolParser {
  detect: (raw: string) => string | null;
  strip: (raw: string) => string;
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createToolParser(names: string[]): ToolParser {
  const safeNames = names.filter(Boolean).map(escapeForRegex);
  const alternation = safeNames.join("|") || "__no_tools__";

  const shorthandTagRe = new RegExp(
    `<(${alternation})>([\\s\\S]*?)</\\1>`,
    "i",
  );

  const malformedTagRe = new RegExp(
    `<(${alternation})\\s*(\\{[\\s\\S]*?\\})`,
    "i",
  );

  const bareJsonRe = new RegExp(
    `\\{\\s*"name"\\s*:\\s*"(?:${alternation})"\\s*,\\s*"(?:args|arguments|parameters)"\\s*:\\s*\\{[\\s\\S]*?\\}\\s*\\}`,
    "i",
  );

  const stripPatterns: RegExp[] = [
    /<think>[\s\S]*?<\/think>/gi,
    /<think>[\s\S]*$/gi,
    /<\/think>/gi,
    new RegExp(
      `<(?:tool|tool_call|function|invoke|${alternation})>[\\s\\S]*?(<\\/(?:tool|tool_call|function|invoke|${alternation})>|$)`,
      "gi",
    ),
    new RegExp(`<(?:${alternation})\\s*\\{[\\s\\S]*?\\}\\}?>?`, "gi"),
    new RegExp(
      `\\{\\s*"name"\\s*:\\s*"(?:${alternation})"[\\s\\S]*?\\}\\s*\\}`,
      "gi",
    ),
    /<tool\s+[a-zA-Z0-9_]+\s*=\s*\{[\s\S]*?\}\s*\/?>?/gi,
    FUNCTION_ENVELOPE_RE,
    TOOL_CALLS_ENVELOPE_RE,
    ORPHAN_BRACE_LINE_RE,
  ];

  const detect = (raw: string): string | null => {
    const tagged = raw.match(TOOL_TAG_RE);
    if (tagged) return tagged[1];

    const shorthand = raw.match(shorthandTagRe);
    if (shorthand) {
      const name = shorthand[1];
      const inner = shorthand[2].trim();
      const parsed = inner.startsWith("{")
        ? safeJsonParse<Record<string, unknown>>(inner)
        : null;

      if (parsed) return JSON.stringify({ name, args: parsed });
      return JSON.stringify({ name, args: primaryArgument(name, inner) });
    }

    const malformed = raw.match(malformedTagRe);
    if (malformed) {
      const jsonStr = malformed[2].replace(/\}\}+$/, "}").replace(/>$/, "").trim();
      const parsed = safeJsonParse<Record<string, unknown>>(jsonStr);
      if (parsed) return JSON.stringify({ name: malformed[1], args: parsed });
    }

    const bareJson = raw.match(bareJsonRe);
    if (bareJson) return bareJson[0];

    const reactStyle = raw.match(REACT_TOOL_RE);
    if (reactStyle) {
      const jsonStr = reactStyle[2]
        .replace(/\}\}+>?$/, "}")
        .replace(/>$/, "")
        .trim();
      const args = safeJsonParse<Record<string, unknown>>(jsonStr);
      if (args) return JSON.stringify({ name: reactStyle[1], args });
    }

    return null;
  };

  const strip = (raw: string): string => {
    const { masked, restore } = protectCode(raw);

    let text = masked;
    for (const pattern of stripPatterns) text = text.replace(pattern, "");

    return restore(text).trim();
  };

  return { detect, strip };
}

const PRIMARY_ARGUMENT: Record<string, string> = {
  search_web: "query",
  search_library: "query",
  read_url: "url",
  browser_navigate: "url",
  browser_press_key: "key",
};

function primaryArgument(name: string, value: string): Record<string, string> {
  const key = PRIMARY_ARGUMENT[name] || "query";
  return { [key]: value };
}

let activeParser = createToolParser(allToolNames());

onRegistryChange(() => {
  activeParser = createToolParser(allToolNames());
});

export function detectToolCall(raw: string): string | null {
  return activeParser.detect(raw);
}

export function stripToolSyntax(raw: string): string {
  return activeParser.strip(raw);
}

export function extractThought(raw: string): string | null {
  const closed = raw.match(THINK_CLOSED_RE);
  if (closed) return closed[1];
  const open = raw.match(THINK_OPEN_RE);
  return open ? open[1] : null;
}

export function parseToolCall(rawJson: string): {
  name?: string;
  args?: Record<string, unknown>;
} {
  let clean = rawJson.trim();
  if (clean.startsWith("```json")) clean = clean.replace(/^```json\n?/, "");
  else if (clean.startsWith("```")) clean = clean.replace(/^```\n?/, "");
  if (clean.endsWith("```")) clean = clean.replace(/\n?```$/, "");

  const json = clean.match(/\{[\s\S]*\}/);
  if (!json) return {};

  const parsed = safeJsonParse<{
    name?: string;
    args?: Record<string, unknown>;
    arguments?: Record<string, unknown>;
    parameters?: Record<string, unknown>;
  }>(json[0]);

  if (!parsed) return {};

  return {
    name: parsed.name,
    args: parsed.args ?? parsed.arguments ?? parsed.parameters,
  };
}
