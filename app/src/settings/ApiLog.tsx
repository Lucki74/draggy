import { useCallback, useEffect, useState } from "react";
import { uiLocale } from "../i18n";
import { Icon } from "../ui/icons/Icon";
import type { ApiLogEntry } from "../types";
import { copyText } from "../utils";
import { swallowed } from "../logger";

const ICON_BUTTON =
  "rounded-sm p-1.5 text-text-secondary outline-none hover:bg-surface-base hover:text-text-primary focus-visible:ring-2 focus-visible:ring-focus";
const CELLS = "grid grid-cols-[4.5rem_minmax(0,2fr)_minmax(0,1fr)_3rem_4rem_4.5rem_2rem] items-center gap-2";

/** A curl line for one logged request: the key stays a variable and a POST sends an empty object. */
function curlFor(entry: ApiLogEntry, baseUrl: string): string {
  const quote = (text: string) => `'${text.replace(/'/g, "'\\''")}'`;
  const origin = baseUrl.replace(/\/v1\/?$/, "");
  const url = quote(`${origin}${entry.path}`);
  const key = `-H "Authorization: Bearer $DRAGGY_API_KEY"`;
  if (entry.method === "GET") return `curl ${url} ${key}`;
  return `curl -X ${entry.method} ${url} ${key} -H "Content-Type: application/json" -d '{}'`;
}

function clock(seconds: number): string {
  return new Date(seconds * 1000).toLocaleTimeString(uiLocale(), { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** The recent requests the server kept in memory, newest first. It reloads when the page opens and
 * when the refresh button is pressed. */
export default function ApiLog({
  t,
  baseUrl,
  enabled,
}: {
  t: (key: string) => string;
  baseUrl: string;
  /** Whether the log is being kept, so an empty list reads right. */
  enabled: boolean;
}) {
  const api = window.draggy?.apiServer;
  const [entries, setEntries] = useState<ApiLogEntry[]>([]);
  const [copied, setCopied] = useState<number | null>(null);

  const load = useCallback(() => {
    api
      ?.log()
      .then(setEntries)
      .catch(swallowed("settings", "the main process already logged this call"));
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  if (!api) return null;

  const clear = () => {
    api
      .clearLog()
      .then(() => setEntries([]))
      .catch(swallowed("settings", "the main process already logged this call"));
  };

  const copy = async (index: number) => {
    if (!(await copyText(curlFor(entries[index], baseUrl)))) return;
    setCopied(index);
    setTimeout(() => setCopied((current) => (current === index ? null : current)), 1500);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-1">
        <button type="button" className={ICON_BUTTON} aria-label={t("apiLogRefresh")} onClick={load}>
          <Icon name="arrow-clockwise" size={14} />
        </button>
        <button
          type="button"
          className={ICON_BUTTON}
          aria-label={t("apiLogClear")}
          disabled={entries.length === 0}
          onClick={clear}
        >
          <Icon name="trash" size={14} />
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="text-[13px] text-text-tertiary">{enabled ? t("apiLogEmpty") : t("apiLogOff")}</p>
      ) : (
        <div role="table" className="text-[12px] text-text-primary">
          <div role="row" className={`${CELLS} border-b border-rule pb-1 text-text-tertiary`}>
            <span role="columnheader">{t("apiLogTime")}</span>
            <span role="columnheader">{t("apiLogRequest")}</span>
            <span role="columnheader">{t("apiLogModel")}</span>
            <span role="columnheader">{t("apiLogStatus")}</span>
            <span role="columnheader">{t("apiLogDuration")}</span>
            <span role="columnheader">{t("apiLogTokens")}</span>
            <span role="columnheader" />
          </div>
          {entries.map((entry, index) => (
            <div
              key={`${entry.time}-${index}`}
              role="row"
              className={`${CELLS} border-b border-rule py-1 last:border-b-0`}
            >
              <span role="cell" className="tabular-nums text-text-secondary">
                {clock(entry.time)}
              </span>
              <span role="cell" className="truncate font-mono" title={entry.client}>
                {entry.method} {entry.path}
              </span>
              <span role="cell" className="truncate text-text-secondary" title={entry.model}>
                {entry.model || "-"}
              </span>
              <span role="cell" className={`tabular-nums ${entry.status >= 400 ? "text-text-primary" : "text-text-secondary"}`}>
                {entry.status}
              </span>
              <span role="cell" className="tabular-nums text-text-secondary">
                {entry.durationMs}
              </span>
              <span role="cell" className="tabular-nums text-text-secondary">
                {entry.promptTokens || entry.completionTokens ? `${entry.promptTokens}/${entry.completionTokens}` : "-"}
              </span>
              <button
                type="button"
                role="cell"
                className={ICON_BUTTON}
                aria-label={t("apiLogCopyCurl")}
                title={t("apiLogCopyCurl")}
                onClick={() => void copy(index)}
              >
                <Icon name={copied === index ? "check" : "copy"} size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
