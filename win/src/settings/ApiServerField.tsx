import { useEffect, useState } from "react";
import { Icon } from "../ui/icons/Icon";
import { StatusDot } from "../ui/StatusDot";
import { Toggle } from "./Controls";
import type { ApiServerStatus } from "../types";
import { copyText } from "../utils";
import { swallowed } from "../logger";

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
      .catch(swallowed("settings", "the main process already logged this call"));
    return () => {
      current = false;
    };
  }, [api]);

  if (!api) return null;
  if (!status) return <Icon name="circle-notch" size={16} className="animate-spin text-text-tertiary" />;

  const apply = async (work: () => Promise<ApiServerStatus>) => {
    setBusy(true);
    try {
      setStatus(await work());
    } finally {
      setBusy(false);
    }
  };

  const copy = async (label: string, text: string) => {
    if (!(await copyText(text))) return;
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
        <span className="text-[14px] text-text-primary">{t("apiServerEnable")}</span>
        {busy && <Icon name="circle-notch" size={16} className="animate-spin text-text-tertiary" />}
      </div>

      <p className="text-[13px] leading-5 text-text-secondary">{t("apiServerHint")}</p>

      {status.enabled && (
        <div className="space-y-3 rounded-md bg-surface-raised p-4">
          <p role="status" className="flex items-center gap-2 text-[13px] text-text-primary">
            <StatusDot status={status.running ? "ok" : "danger"} />
            {status.running
              ? t("apiServerListening")
              : `${t("apiServerStopped")}${status.error ? `: ${status.error}` : ""}`}
          </p>

          <label className="block">
            <span className="text-[12px] font-medium leading-4 text-text-secondary">
              {t("apiServerAddress")}
            </span>
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-sm bg-surface-base px-3 py-1.5 font-mono text-[12px] text-text-primary shadow-[inset_0_0_0_1px_var(--rule)]">
                {status.baseUrl}
              </code>
              <button
                onClick={() => copy("url", status.baseUrl)}
                aria-label={t("apiServerCopyAddress")}
                title={t("apiServerCopyAddress")}
                type="button"
                  className="rounded-sm p-2 text-text-secondary outline-none hover:bg-surface-base hover:text-text-primary focus-visible:ring-2 focus-visible:ring-focus"
              >
                {copied === "url" ? <Icon name="check" size={16} /> : <Icon name="copy" size={16} />}
              </button>
            </div>
          </label>

          <label className="block">
            <span className="text-[12px] font-medium leading-4 text-text-secondary">
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
              className="mt-1 h-8 w-32 rounded-sm bg-surface-base px-3 text-[13px] text-text-primary shadow-[inset_0_0_0_1px_var(--rule-control)] placeholder:text-text-tertiary outline-none focus-visible:ring-2 focus-visible:ring-focus"
            />
          </label>

          {status.key && (
            <label className="block">
              <span className="text-[12px] font-medium leading-4 text-text-secondary">
                {t("apiServerKey")}
              </span>
              <div className="mt-1 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-sm bg-surface-base px-3 py-1.5 font-mono text-[12px] text-text-primary shadow-[inset_0_0_0_1px_var(--rule)]">
                  {revealed ? status.key : "•".repeat(24)}
                </code>
                <button
                  onClick={() => setRevealed((value) => !value)}
                  aria-label={revealed ? t("apiServerHideKey") : t("apiServerShowKey")}
                  title={revealed ? t("apiServerHideKey") : t("apiServerShowKey")}
                  type="button"
                  className="rounded-sm p-2 text-text-secondary outline-none hover:bg-surface-base hover:text-text-primary focus-visible:ring-2 focus-visible:ring-focus"
                >
                  {revealed ? <Icon name="eye-slash" size={16} /> : <Icon name="eye" size={16} />}
                </button>
                <button
                  onClick={() => copy("key", status.key as string)}
                  aria-label={t("apiServerCopyKey")}
                  title={t("apiServerCopyKey")}
                  type="button"
                  className="rounded-sm p-2 text-text-secondary outline-none hover:bg-surface-base hover:text-text-primary focus-visible:ring-2 focus-visible:ring-focus"
                >
                  {copied === "key" ? <Icon name="check" size={16} /> : <Icon name="copy" size={16} />}
                </button>
                <button
                  onClick={() => void apply(() => api.regenerateKey())}
                  aria-label={t("apiServerNewKey")}
                  title={t("apiServerNewKey")}
                  type="button"
                  className="rounded-sm p-2 text-text-secondary outline-none hover:bg-surface-base hover:text-text-primary focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <Icon name="arrow-clockwise" size={16} />
                </button>
              </div>
            </label>
          )}

        </div>
      )}
    </div>
  );
}
