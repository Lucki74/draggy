import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Block, Button, Group, Page, Row, Segmented, Toggle } from "./Controls";
import { Icon } from "../ui/icons/Icon";
import { logSwallow, swallowed } from "../logger";
import type { LogLevelState } from "../types";
import { ORDER, parseEvents, type Level, type LogLine } from "./logLines";

type Translate = (key: string) => string;

const VERBOSE_MS = 60 * 60 * 1000;
const TAIL_BYTES = 256 * 1024;
const FOLLOW_MS = 2000;
const VISIBLE_LINES = 400;

const sizeLabel = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`);
const clock = (ts: string) => ts.slice(11, 19);

const LEVEL_TONE: Record<Level, string> = {
  DEBUG: "text-text-tertiary",
  INFO: "text-ok",
  WARN: "font-medium text-warn",
  ERROR: "text-danger",
};

const fieldClass =
  "h-8 rounded-sm bg-surface-base px-3 text-[13px] text-text-primary shadow-[inset_0_0_0_1px_var(--rule-control)] placeholder:text-text-tertiary outline-none focus-visible:ring-2 focus-visible:ring-focus";

function LoggingGroup({ t }: { t: Translate }) {
  const [state, setState] = useState<LogLevelState | null>(null);
  const [scopes, setScopes] = useState("");
  const api = window.electronAPI;

  useEffect(() => {
    api?.getLogLevel().then(setState).catch(swallowed("settings", "the main process already logged this call"));
  }, [api]);

  const apply = (options: Parameters<NonNullable<typeof api>["setLogLevel"]>[0]) =>
    api?.setLogLevel(options).then(setState).catch(swallowed("settings", "the main process already logged this call"));

  const verbose = state?.level === "DEBUG";
  const until = verbose && state?.until ? new Date(state.until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
  const scopeList = scopes.split(",").map((scope) => scope.trim()).filter(Boolean);

  return (
    <Group title={t("diagLogging")}>
      <Row
        label={t("diagVerbose")}
        description={until ? t("diagVerboseUntil").replace("{time}", until) : undefined}
      >
        {verbose ? (
          <Button onClick={() => apply({ level: "INFO", scopes: [], keep: false })}>{t("diagVerboseOff")}</Button>
        ) : (
          <Button tone="primary" disabled={!state} onClick={() => apply({ level: "DEBUG", scopes: scopeList, durationMs: VERBOSE_MS })}>
            {t("diagVerboseOn")}
          </Button>
        )}
      </Row>
      <Row label={t("diagScopes")}>
        <input
          type="text"
          value={scopes}
          onChange={(event) => setScopes(event.target.value)}
          aria-label={t("diagScopes")}
          placeholder="engine, mcp"
          disabled={verbose}
          className={`${fieldClass} w-48 disabled:opacity-40`}
        />
      </Row>
      <Row label={t("diagKeep")}>
        <Toggle
          checked={Boolean(state?.keep)}
          disabled={!state || !verbose}
          label={t("diagKeep")}
          onChange={(keep) => apply({ level: "DEBUG", scopes: state?.scopes ?? [], keep, durationMs: keep ? undefined : VERBOSE_MS })}
        />
      </Row>
      <Row label={t("openLogFolder")}>
        <Button onClick={() => api?.openLogs()}>
          <Icon name="file-text" size={16} />
          {t("openLogFolder")}
        </Button>
      </Row>
    </Group>
  );
}

function LogViewer({ t }: { t: Translate }) {
  const [lines, setLines] = useState<LogLine[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [level, setLevel] = useState<Level>("INFO");
  const [scope, setScope] = useState("");
  const [cid, setCid] = useState("");
  const [thisSession, setThisSession] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  /** Like the chat: the list follows new lines while it sits at the bottom and lets go when scrolled up. */
  const pinned = useRef(true);

  const load = useCallback(() => {
    const api = window.electronAPI;
    if (!api) return;
    api
      .readLogs("events", TAIL_BYTES)
      .then((text) => {
        setLines(parseEvents(text));
        setFailed(false);
      })
      .catch((error) => {
        logSwallow("settings", error, "the viewer shows its own retry state");
        setFailed(true);
      });
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, FOLLOW_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const session = lines?.at(-1)?.session;
  const shown = useMemo(() => {
    if (!lines) return [];
    const wanted = scope.trim().toLowerCase();
    const id = cid.trim();
    return lines
      .filter((line) => ORDER[line.level] >= ORDER[level])
      .filter((line) => !thisSession || !session || line.session === session)
      .filter((line) => !wanted || line.scope.toLowerCase().includes(wanted))
      .filter((line) => !id || (line.cid ?? "").startsWith(id))
      .slice(-VISIBLE_LINES);
  }, [lines, level, scope, cid, thisSession, session]);

  useEffect(() => {
    if (pinned.current && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [shown]);

  useEffect(() => {
    if (!full) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFull(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  useEffect(() => {
    pinned.current = true;
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [full]);

  const onScroll = () => {
    const list = listRef.current;
    if (list) pinned.current = list.scrollHeight - list.scrollTop - list.clientHeight < 24;
  };

  const copy = (line: LogLine) => {
    navigator.clipboard
      .writeText(line.raw)
      .then(() => {
        setCopied(line.raw);
        window.setTimeout(() => setCopied((current) => (current === line.raw ? null : current)), 1500);
      })
      .catch(swallowed("settings", "the clipboard can be blocked; the line stays selectable"));
  };

  const levelOptions: { id: Level; label: string }[] = [
    { id: "DEBUG", label: t("diagLevelDebug") },
    { id: "INFO", label: t("diagLevelInfo") },
    { id: "WARN", label: t("diagLevelWarn") },
    { id: "ERROR", label: t("diagLevelError") },
  ];

  const viewer = (
    <>
      <Block>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented value={level} options={levelOptions} onChange={setLevel} label={t("diagnostics")} />
          <input type="text" value={scope} onChange={(event) => setScope(event.target.value)} aria-label={t("diagFilterScope")} placeholder={t("diagFilterScope")} className={`${fieldClass} w-28`} />
          <input type="text" value={cid} onChange={(event) => setCid(event.target.value)} aria-label={t("diagFilterCid")} placeholder={t("diagFilterCid")} className={`${fieldClass} w-36 font-mono`} />
          <label className="flex items-center gap-2 text-[13px] text-text-secondary">
            <Toggle checked={thisSession} onChange={setThisSession} label={t("diagThisSession")} />
            {t("diagThisSession")}
          </label>
          <button
            type="button"
            onClick={() => setFull((value) => !value)}
            aria-label={full ? t("diagExitFullscreen") : t("diagFullscreen")}
            aria-pressed={full}
            title={full ? t("diagExitFullscreen") : t("diagFullscreen")}
            className="ms-auto rounded-sm p-1.5 text-text-tertiary outline-none transition-colors hover:bg-surface-raised hover:text-text-primary focus-visible:ring-2 focus-visible:ring-focus"
          >
            <Icon name={full ? "arrows-in-simple" : "arrows-out-simple"} size={16} />
          </button>
        </div>
      </Block>
      <div ref={listRef} onScroll={onScroll} className={`min-h-24 overflow-auto px-2 py-2 ${full ? "min-h-0 flex-1" : "max-h-[360px]"}`} role="log" aria-live="off" aria-busy={lines === null}>
        {failed && (
          <div className="flex items-center justify-between gap-3 px-2 py-3 text-[13px] text-danger">
            <span>{t("diagLoadFailed")}</span>
            <Button onClick={load}>{t("retry")}</Button>
          </div>
        )}
        {!failed && lines === null && (
          <div className="space-y-2 px-2 py-2" aria-label={t("loading")}>
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="h-4 animate-pulse rounded-sm bg-surface-raised" style={{ width: `${90 - row * 12}%` }} />
            ))}
          </div>
        )}
        {!failed && lines !== null && lines.length === 0 && <p className="px-2 py-3 text-[13px] text-text-secondary">{t("diagEmptyLog")}</p>}
        {!failed && lines !== null && lines.length > 0 && shown.length === 0 && <p className="px-2 py-3 text-[13px] text-text-secondary">{t("diagNoMatch")}</p>}
        {shown.map((line, index) => (
          <div key={`${line.ts}-${index}`} className="group flex items-start gap-2 rounded-sm px-2 py-0.5 font-mono text-[12px] leading-5 hover:bg-surface-raised">
            <span className="flex-shrink-0 tabular-nums text-text-tertiary">{clock(line.ts)}</span>
            <span className={`w-12 flex-shrink-0 ${LEVEL_TONE[line.level]}`}>{line.level}</span>
            <span className="w-20 flex-shrink-0 truncate text-text-secondary" title={line.scope}>
              {line.scope}
            </span>
            <span className="min-w-0 flex-1 break-words text-text-primary">{line.msg}</span>
            <button
              type="button"
              onClick={() => copy(line)}
              aria-label={t("diagCopyLine")}
              title={copied === line.raw ? t("diagCopied") : t("diagCopyLine")}
              className="flex-shrink-0 rounded-sm p-1 text-text-tertiary opacity-0 outline-none transition-opacity hover:text-text-primary focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-focus group-hover:opacity-100"
            >
              <Icon name={copied === line.raw ? "check" : "copy"} size={14} />
            </button>
          </div>
        ))}
      </div>
    </>
  );

  if (full) {
    // Portaled so an ancestor with a transform or containment cannot shrink the overlay.
    return createPortal(
      <div className="fixed inset-x-0 bottom-0 top-10 z-50 flex flex-col bg-surface-canvas" role="dialog" aria-label={t("diagViewer")}>
        {viewer}
      </div>,
      document.body,
    );
  }
  return <Group title={t("diagViewer")}>{viewer}</Group>;
}

function ExportGroup({ t }: { t: Translate }) {
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [includeDebug, setIncludeDebug] = useState(false);
  const [includeDumps, setIncludeDumps] = useState(false);
  const [result, setResult] = useState<{ key: string; files: { name: string; size: number }[] | null } | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saved, setSaved] = useState("");
  const api = window.electronAPI;
  const key = `${includeDebug}|${includeDumps}|${attempt}`;

  useEffect(() => {
    if (!open || !api) return;
    let current = true;
    api.diagnostics
      .preview({ includeDebug, includeDumps })
      .then((files) => {
        if (current) setResult({ key, files });
      })
      .catch((error) => {
        logSwallow("settings", error, "the preview shows its own retry state");
        if (current) setResult({ key, files: null });
      });
    return () => {
      current = false;
    };
  }, [open, includeDebug, includeDumps, key, api]);

  const fresh = result?.key === key ? result : null;
  const preview = fresh?.files ?? null;
  const loading = open && !fresh;
  const previewFailed = Boolean(fresh && !fresh.files);

  const save = () => {
    if (!api) return;
    setStatus("saving");
    api.diagnostics
      .export({ includeDebug, includeDumps })
      .then((result) => {
        if (!result.saved) {
          setStatus("idle");
          return;
        }
        setSaved(t("diagSaved").replace("{size}", sizeLabel(result.bytes ?? 0)));
        setStatus("saved");
        setOpen(false);
      })
      .catch((error) => {
        logSwallow("settings", error, "the export shows its own error state");
        setStatus("error");
      });
  };

  const total = preview?.reduce((sum, file) => sum + file.size, 0) ?? 0;

  return (
    <Group title={t("diagExport")}>
      {!open && (
        <>
          <button
            type="button"
            onClick={() => {
              setStatus("idle");
              setOpen(true);
            }}
            className="flex w-full items-center justify-center gap-2 px-4 py-3.5 text-[14px] font-medium text-text-primary outline-none transition-colors hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-focus"
          >
            <Icon name="download-simple" size={16} />
            {t("diagExport")}
          </button>
          {status === "saved" && <p className="px-4 pb-3 text-[13px] leading-5 text-text-secondary">{saved}</p>}
          {status === "error" && <p className="px-4 pb-3 text-[13px] leading-5 text-danger">{t("diagExportFailed")}</p>}
        </>
      )}
      {open && (
        <Block>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="flex items-center justify-between gap-4 text-[13px] text-text-primary">
                {t("diagIncludeDebug")}
                <Toggle checked={includeDebug} onChange={setIncludeDebug} label={t("diagIncludeDebug")} />
              </label>
              <label className="flex items-center justify-between gap-4 text-[13px] text-text-primary">
                {t("diagIncludeDumps")}
                <Toggle checked={includeDumps} onChange={setIncludeDumps} label={t("diagIncludeDumps")} />
              </label>
            </div>
            <div>
              <p className="mb-1 text-[13px] font-medium text-text-secondary">{t("diagPreviewTitle")}</p>
              {previewFailed ? (
                <div className="flex items-center justify-between gap-3 text-[13px] text-danger">
                  <span>{t("diagPreviewFailed")}</span>
                  <Button onClick={() => setAttempt((value) => value + 1)}>{t("retry")}</Button>
                </div>
              ) : !preview || loading ? (
                <div className="space-y-2" aria-label={t("loading")}>
                  {[0, 1, 2].map((row) => (
                    <div key={row} className="h-4 animate-pulse rounded-sm bg-surface-raised" style={{ width: `${80 - row * 15}%` }} />
                  ))}
                </div>
              ) : (
                <ul className="divide-y divide-rule rounded-md bg-surface-raised">
                  {preview.map((file) => (
                    <li key={file.name} className="flex items-center justify-between gap-3 px-3 py-1.5 font-mono text-[12px] text-text-primary">
                      <span className="min-w-0 truncate">{file.name}</span>
                      <span className="flex-shrink-0 tabular-nums text-text-secondary">{sizeLabel(file.size)}</span>
                    </li>
                  ))}
                  <li className="flex items-center justify-between px-3 py-1.5 text-[12px] text-text-secondary">
                    <Badge>{preview.length}</Badge>
                    <span className="tabular-nums">{sizeLabel(total)}</span>
                  </li>
                </ul>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setOpen(false)}>{t("cancel")}</Button>
              <Button tone="primary" disabled={!preview || loading || status === "saving"} onClick={save}>
                {status === "saving" ? t("loading") : t("diagSave")}
              </Button>
            </div>
          </div>
        </Block>
      )}
    </Group>
  );
}

export function DiagnosticsPage({ t }: { t: Translate }) {
  return (
    <Page title={t("diagnostics")}>
      <LoggingGroup t={t} />
      <LogViewer t={t} />
      <ExportGroup t={t} />
    </Page>
  );
}
