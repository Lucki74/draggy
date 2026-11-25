export const ORDER = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 } as const;
export type Level = keyof typeof ORDER;

export interface LogLine {
  ts: string;
  level: Level;
  session?: string;
  scope: string;
  msg: string;
  cid?: string;
  raw: string;
}

/** The newest lines of events.jsonl. The first line of a tail is usually cut, so it is dropped when it fails to parse. */
function parseLine(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null; // a line cut by the tail window
  }
}

export function parseEvents(text: string): LogLine[] {
  const lines: LogLine[] = [];
  for (const raw of text.split("\n")) {
    const entry = raw ? parseLine(raw) : null;
    if (entry && typeof entry.msg === "string" && typeof entry.level === "string" && entry.level in ORDER) {
      lines.push({ ts: String(entry.ts ?? ""), level: entry.level as Level, session: entry.session as string | undefined, scope: String(entry.scope ?? ""), msg: entry.msg, cid: entry.cid as string | undefined, raw });
    }
  }
  return lines;
}
