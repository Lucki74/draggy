import { currentScreen, logSwallow } from "./logger";

interface Subject {
  /** The stack when there is one, else the message the user saw. */
  text: string;
  scope: string;
  /** The id the failure was logged under, so the copied text and the log line join up. */
  cid?: string;
}

/** What a bug report needs: the error, where the app was, which run, which version, and the log lines just before. */
export async function collectErrorDetails({ text, scope, cid }: Subject): Promise<string> {
  const api = window.electronAPI;
  const parts = [text || "Unknown error", "", `scope: ${scope}`, `screen: ${currentScreen()}`];
  if (cid) parts.push(`id: ${cid}`);
  try {
    const info = await api?.appInfo();
    if (info?.version) parts.push(`version: ${info.version}`);
    const events = (await api?.readLogs("events", 64 * 1024)) ?? "";
    const last = events.split("\n").filter(Boolean).at(-1);
    const session = last ? (JSON.parse(last) as { session?: string }).session : undefined;
    if (session) parts.push(`session: ${session}`);
    const app = (await api?.readLogs("app", 16 * 1024)) ?? "";
    const lines = app.split("\n").filter(Boolean);
    const mine = cid ? lines.filter((line) => line.includes(cid)) : [];
    parts.push("", cid && mine.length ? `log lines for ${cid}` : "last log lines", ...(mine.length ? mine : lines).slice(-30));
  } catch (failure) {
    logSwallow("app", failure, "the details are best effort; the text alone still copies");
  }
  return parts.join("\n");
}
