import { useEffect, useState } from "react";
import { ChevronDown, ExternalLink, Loader2, Search } from "lucide-react";
import { Toggle } from "./Controls";
import { hostnameOf, hueFor, siteLabel } from "./../utils";
import type {
  McpCatalogueEntry,
  McpServerConfig,
  McpServerState,
} from "./../types";

/**
 * The extensions panel. Turning a server on runs someone else's program with
 * the credentials typed into it, so every entry names the package it fetches.
 */

type Shown = "all" | "on" | "off";

/**
 * The service's own icon, fetched and cached by the main process and served
 * over `draggy://`, since the renderer may not load remote images.
 */
function ServerIcon({ entry }: { entry: McpCatalogueEntry }) {
  const [failed, setFailed] = useState(false);
  const hostname = entry.site ? hostnameOf(entry.site) : "";

  if (hostname && !failed) {
    return (
      <img
        src={`draggy://favicon/${encodeURIComponent(hostname)}`}
        alt=""
        aria-hidden="true"
        loading="lazy"
        onError={() => setFailed(true)}
        className="w-7 h-7 rounded-md flex-shrink-0 object-contain select-none"
      />
    );
  }

  // A server with no service behind it, or one whose icon would not load,
  // keeps a stable letter rather than leaving a hole in the row.
  const label = hostname ? siteLabel(hostname) : entry.name;

  return (
    <span
      aria-hidden="true"
      className="w-7 h-7 rounded-md flex-shrink-0 flex items-center justify-center text-[11px] font-bold text-white select-none"
      style={{ backgroundColor: `hsl(${hueFor(label)} 55% 45%)` }}
    >
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}

export default function McpPanel({ t }: { t: (key: string) => string }) {
  const [catalogue, setCatalogue] = useState<McpCatalogueEntry[]>([]);
  const [config, setConfig] = useState<Record<string, McpServerConfig>>({});
  const [running, setRunning] = useState<McpServerState[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [shown, setShown] = useState<Shown>("all");

  const api = window.electronAPI?.mcp;

  useEffect(() => {
    if (!api) return;

    api.catalogue().then((result) => setCatalogue(result.servers || []));
    api.config().then((result) => setConfig(result.config || {}));
    api.running().then((result) => setRunning(result.servers || []));
  }, [api]);

  const stateOf = (id: string) => running.find((server) => server.id === id) || null;

  const entryConfig = (id: string): McpServerConfig =>
    config[id] || { enabled: false, env: {}, arguments: {} };

  const persist = async (id: string, next: McpServerConfig) => {
    setConfig((previous) => ({ ...previous, [id]: next }));
    await api?.save(id, next);
  };

  const missingFor = (entry: McpCatalogueEntry) => {
    const current = entryConfig(entry.id);
    const missing: string[] = [];

    for (const variable of entry.env || []) {
      if (variable.required && !String(current.env[variable.key] || "").trim()) {
        missing.push(variable.label);
      }
    }
    for (const argument of entry.arguments || []) {
      const value = current.arguments[argument.key];
      const empty = argument.multiple
        ? !Array.isArray(value) || value.filter(Boolean).length === 0
        : !String(value || "").trim();
      if (argument.required && empty) missing.push(argument.label);
    }

    return missing;
  };

  const toggle = async (entry: McpCatalogueEntry, on: boolean) => {
    const next = { ...entryConfig(entry.id), enabled: on };
    await persist(entry.id, next);

    setBusy(entry.id);
    try {
      // Only servers that are actually running come back from `running()`, so a
      // server that failed to start would lose its own reason on the way here.
      // The reply from `start` carries it, so that one is kept.
      let failed: McpServerState | null = null;

      if (on) {
        const started = await api?.start(entry.id);
        if (started?.state && started.state.status !== "ready") failed = started.state;
      } else {
        await api?.stop(entry.id);
      }

      const fresh = await api?.running();
      const servers = fresh?.servers ?? [];

      setRunning(
        failed
          ? [...servers.filter((server) => server.id !== entry.id), failed]
          : servers,
      );
    } finally {
      setBusy(null);
    }
  };

  const wanted = filter.trim().toLowerCase();

  const visible = catalogue.filter((entry) => {
    if (shown !== "all" && entryConfig(entry.id).enabled !== (shown === "on")) {
      return false;
    }
    if (!wanted) return true;
    return [entry.name, entry.description].some((field) =>
      field.toLowerCase().includes(wanted),
    );
  });

  if (!api) {
    return <p className="text-sm text-[var(--text-muted)]">{t("mcpUnavailable")}</p>;
  }

  const TABS: { id: Shown; label: string }[] = [
    { id: "all", label: t("mcpAll") },
    { id: "on", label: t("mcpEnabled") },
    { id: "off", label: t("mcpDisabled") },
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t("mcpSearch")}
            className="w-full pl-9 pr-3 py-2 rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)] text-sm font-medium outline-none focus:border-[var(--text-muted)]"
          />
        </div>

        <div className="flex rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)] overflow-hidden flex-shrink-0">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setShown(tab.id)}
              aria-pressed={shown === tab.id}
              className={`px-3 py-2 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                shown === tab.id
                  ? "bg-[var(--bg-inverted)] text-[var(--text-inverted)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--hover-bg)]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 && (
        <p className="text-sm text-[var(--text-muted)] py-6 text-center">
          {t("mcpNoMatches")}
        </p>
      )}

      <div className="space-y-2">
        {visible.map((entry) => {
          const current = entryConfig(entry.id);
          const live = stateOf(entry.id);
          const missing = missingFor(entry);
          const open = expanded === entry.id;
          const needsSetup = (entry.env?.length || 0) + (entry.arguments?.length || 0) > 0;

          return (
            <div
              key={entry.id}
              className="rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)] overflow-hidden"
            >
              <div className="p-4 flex items-start gap-3">
                <div className="pt-0.5">
                  <ServerIcon entry={entry} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold">{entry.name}</span>
                    {live?.status === "ready" && (
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border border-[var(--border-light)] text-[var(--text-muted)]">
                        {live.tools.length} {t("mcpTools")}
                      </span>
                    )}
                    {busy === entry.id && (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-muted)]" />
                    )}
                  </div>

                  <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
                    {entry.description}
                  </p>

                  <div className="flex items-center gap-3 mt-2 flex-wrap">
                    <a
                      href={entry.docs}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
                    >
                      <ExternalLink className="w-3 h-3" />
                      {t("mcpPackageDocs")}
                    </a>

                    {entry.site && (
                      <a
                        href={entry.site}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />
                        {t("mcpWebsite")}
                      </a>
                    )}

                    <code className="text-[10px] text-[var(--text-muted)] opacity-70 truncate">
                      {entry.package}
                    </code>
                  </div>

                  {entry.caution && (
                    <p className="text-[11px] mt-2 font-medium text-amber-600 dark:text-amber-500">
                      {entry.caution}
                    </p>
                  )}

                  {live?.status === "error" && live.error && (
                    <p className="text-[11px] mt-2 font-medium text-red-500 break-words">
                      {live.error}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {needsSetup && (
                    <button
                      onClick={() => setExpanded(open ? null : entry.id)}
                      className="p-2 rounded-lg hover:bg-[var(--hover-bg)]"
                      aria-label={t("mcpConfigure")}
                    >
                      <ChevronDown
                        className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`}
                      />
                    </button>
                  )}
                  <Toggle
                    checked={current.enabled}
                    onChange={(value) => {
                      // Starting a server that cannot run wastes ten seconds
                      // to report what we already knew.
                      if (value && missing.length > 0) {
                        setExpanded(entry.id);
                        return;
                      }
                      void toggle(entry, value);
                    }}
                  />
                </div>
              </div>

              {open && needsSetup && (
                <div className="px-4 pb-4 space-y-3 border-t-[3px] border-[var(--border-light)] pt-3">
                  {(entry.arguments || []).map((argument) => (
                    <label key={argument.key} className="block">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                        {argument.label}
                      </span>
                      <input
                        value={
                          argument.multiple
                            ? ((current.arguments[argument.key] as string[]) || []).join("\n")
                            : String(current.arguments[argument.key] || "")
                        }
                        placeholder={argument.placeholder}
                        onChange={(event) =>
                          persist(entry.id, {
                            ...current,
                            arguments: {
                              ...current.arguments,
                              [argument.key]: argument.multiple
                                ? event.target.value.split("\n").filter(Boolean)
                                : event.target.value,
                            },
                          })
                        }
                        className="w-full mt-1 px-3 py-2 rounded-lg border-[3px] border-[var(--border-light)] bg-[var(--bg-base)] text-sm outline-none focus:border-[var(--text-muted)]"
                      />
                    </label>
                  ))}

                  {(entry.env || []).map((variable) => (
                    <label key={variable.key} className="block">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                        {variable.label}
                        {!variable.required && ` (${t("optional")})`}
                      </span>
                      <input
                        type={variable.secret ? "password" : "text"}
                        value={String(current.env[variable.key] || "")}
                        onChange={(event) =>
                          persist(entry.id, {
                            ...current,
                            env: { ...current.env, [variable.key]: event.target.value },
                          })
                        }
                        className="w-full mt-1 px-3 py-2 rounded-lg border-[3px] border-[var(--border-light)] bg-[var(--bg-base)] text-sm outline-none focus:border-[var(--text-muted)]"
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
