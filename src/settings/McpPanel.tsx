import { useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, Loader2, Search } from "lucide-react";
import { Toggle } from "./Controls";
import type {
  McpCatalogueEntry,
  McpServerConfig,
  McpServerState,
} from "./../types";

export default function McpPanel({ t }: { t: (key: string) => string }) {
  const [catalogue, setCatalogue] = useState<McpCatalogueEntry[]>([]);
  const [categories, setCategories] = useState<{ id: string; label: string }[]>([]);
  const [config, setConfig] = useState<Record<string, McpServerConfig>>({});
  const [running, setRunning] = useState<McpServerState[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const api = window.electronAPI?.mcp;

  useEffect(() => {
    if (!api) return;

    api.catalogue().then((result) => {
      setCatalogue(result.servers || []);
      setCategories(result.categories || []);
    });
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
      if (on) await api?.start(entry.id);
      else await api?.stop(entry.id);

      // Asked for rather than assembled from the reply: a server can fail
      // after spawning, and only the main process knows what is running.
      const fresh = await api?.running();
      if (fresh?.servers) setRunning(fresh.servers);
    } finally {
      setBusy(null);
    }
  };

  const shown = catalogue.filter((entry) => {
    const wanted = filter.trim().toLowerCase();
    if (!wanted) return true;
    return [entry.name, entry.description, entry.category].some((field) =>
      field.toLowerCase().includes(wanted),
    );
  });

  if (!api) {
    return (
      <p className="text-sm text-[var(--text-muted)]">{t("mcpUnavailable")}</p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="p-4 rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)] flex gap-3">
        <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5 text-[var(--text-muted)]" />
        <p className="text-xs leading-relaxed text-[var(--text-muted)]">
          {t("mcpWarning")}
        </p>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t("mcpSearch")}
          className="w-full pl-9 pr-3 py-2 rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)] text-sm font-medium outline-none focus:border-[var(--text-muted)]"
        />
      </div>

      {categories.map((category) => {
        const entries = shown.filter((entry) => entry.category === category.id);
        if (entries.length === 0) return null;

        return (
          <div key={category.id} className="space-y-2">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)]">
              {category.label}
            </h3>

            {entries.map((entry) => {
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

                      <code className="text-[10px] text-[var(--text-muted)] opacity-70 mt-1 block truncate">
                        npx -y {entry.package}
                      </code>

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

                      {missing.length > 0 && (
                        <p className="text-[11px] mt-2 font-medium text-[var(--text-muted)]">
                          {t("mcpNeeds")} {missing.join(", ")}
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
                          // Starting a server that cannot run wastes ten
                          // seconds to report what we already knew.
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
                                ? (
                                    (current.arguments[argument.key] as string[]) || []
                                  ).join("\n")
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
        );
      })}
    </div>
  );
}
