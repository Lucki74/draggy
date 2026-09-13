import { useEffect, useState } from "react";
import { Check, Copy, Eye, EyeOff, Loader2, RefreshCw } from "lucide-react";
import { Toggle } from "./Controls";
import type { ApiServerStatus } from "../types";

interface ApiServerFieldProps {
  t: (key: string) => string;
}

/** The local API switch, off by default. When on it shows the address, the key and whether it
 * listens, with the warning that the key grants model use. */
export default function ApiServerField({ t }: ApiServerFieldProps) {
  const [status, setStatus] = useState<ApiServerStatus | null>(null);
  const [portDraft, setPortDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const api = window.electronAPI?.apiServer;

  useEffect(() => {
    if (!api) return;
    let current = true;
    api
      .status()
      .then((next) => {
        if (current) setStatus(next);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [api]);

  if (!api) return null;
  if (!status) return <Loader2 className="w-4 h-4 animate-spin text-[var(--text-muted)]" />;

  const apply = async (work: () => Promise<ApiServerStatus>) => {
    setBusy(true);
    try {
      setStatus(await work());
    } finally {
      setBusy(false);
    }
  };

  const copy = (label: string, text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };

  const commitPort = () => {
    if (portDraft === null) return;
    const port = Number(portDraft);
    setPortDraft(null);
    if (Number.isInteger(port) && port >= 1024 && port <= 65535 && port !== status.port) {
      void apply(() => api.configure({ port }));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Toggle
          checked={status.enabled}
          onChange={(enabled) => void apply(() => api.configure({ enabled }))}
        />
        <span className="text-sm font-bold">{t("apiServerEnable")}</span>
        {busy && <Loader2 className="w-4 h-4 animate-spin text-[var(--text-muted)]" />}
      </div>

      <p className="text-xs font-medium text-[var(--text-muted)]">{t("apiServerHint")}</p>

      {status.enabled && (
        <div className="space-y-3 rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)] p-4">
          <p
            role="status"
            className={`text-xs font-bold ${status.running ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}
          >
            {status.running
              ? t("apiServerListening")
              : `${t("apiServerStopped")}${status.error ? `: ${status.error}` : ""}`}
          </p>

          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              {t("apiServerAddress")}
            </span>
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-[var(--bg-base)] px-3 py-2 text-xs">
                {status.baseUrl}
              </code>
              <button
                onClick={() => copy("url", status.baseUrl)}
                aria-label={t("apiServerCopyAddress")}
                title={t("apiServerCopyAddress")}
                className="p-2 rounded-lg hover:bg-[var(--hover-bg)]"
              >
                {copied === "url" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </label>

          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              {t("apiServerPort")}
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={portDraft ?? String(status.port)}
              onChange={(event) => setPortDraft(event.target.value)}
              onBlur={commitPort}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitPort();
              }}
              className="mt-1 w-32 p-2 ui-input text-sm font-bold"
            />
          </label>

          {status.key && (
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                {t("apiServerKey")}
              </span>
              <div className="mt-1 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-[var(--bg-base)] px-3 py-2 text-xs">
                  {revealed ? status.key : "•".repeat(24)}
                </code>
                <button
                  onClick={() => setRevealed((value) => !value)}
                  aria-label={revealed ? t("apiServerHideKey") : t("apiServerShowKey")}
                  title={revealed ? t("apiServerHideKey") : t("apiServerShowKey")}
                  className="p-2 rounded-lg hover:bg-[var(--hover-bg)]"
                >
                  {revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => copy("key", status.key as string)}
                  aria-label={t("apiServerCopyKey")}
                  title={t("apiServerCopyKey")}
                  className="p-2 rounded-lg hover:bg-[var(--hover-bg)]"
                >
                  {copied === "key" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => void apply(() => api.regenerateKey())}
                  aria-label={t("apiServerNewKey")}
                  title={t("apiServerNewKey")}
                  className="p-2 rounded-lg hover:bg-[var(--hover-bg)]"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            </label>
          )}

        </div>
      )}
    </div>
  );
}
