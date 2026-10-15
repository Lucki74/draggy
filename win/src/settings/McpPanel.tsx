import { useEffect, useState } from "react";
import { Icon } from "../ui/icons/Icon";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import type { MenuEntry } from "../ui/Menu";
import { SegmentedControl } from "../ui/SegmentedControl";
import type { StatusKind } from "../ui/StatusDot";
import { ExtensionList, ExtensionRow } from "../extensions/ExtensionRow";
import { fill } from "../onboarding/text";
import { ConfirmDialog, Toggle } from "./Controls";
import { hostnameOf, hueFor, siteLabel } from "./../utils";
import type {
  RegistryEntry,
  McpCatalogueEntry,
  McpServerConfig,
  McpServerState,
} from "./../types";

/** The extensions panel. Turning a server on runs someone else's program with the credentials typed
 * into it, so every entry names the package it fetches. */

type Shown = "all" | "on" | "off";

/** The service's own icon, fetched and cached by the main process and served over `draggy://`,
 * since the renderer may not load remote images. */
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
        className="h-7 w-7 flex-shrink-0 select-none rounded-sm object-contain"
      />
    );
  }

  // A server with no service behind it, or one whose icon would not load,
  // keeps a stable letter rather than leaving a hole in the row.
  const label = hostname ? siteLabel(hostname) : entry.name;

  return (
    <span
      aria-hidden="true"
      className="flex h-7 w-7 flex-shrink-0 select-none items-center justify-center rounded-sm text-[11px] font-medium text-white"
      style={{ backgroundColor: `hsl(${hueFor(label)} 55% 45%)` }}
    >
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** What a row says about a server, from what it is doing now down to whether it is switched on. */
function statusOf(
  on: boolean,
  live: McpServerState | null,
  busy: boolean,
  missing: string[],
  t: (key: string) => string,
): { kind: StatusKind; text: string } {
  if (busy) return { kind: "idle", text: t(on ? "serverStarting" : "serverStopping") };
  if (live?.status === "ready") return { kind: "ok", text: `${t("serverRunning")} · ${live.tools.length} ${t("mcpTools")}` };
  if (live?.status === "error") return { kind: "danger", text: t("serverFailed") };
  if (on && missing.length > 0) return { kind: "warn", text: t("serverNeedsSetup") };
  if (on) return { kind: "idle", text: t("serverIdle") };
  return { kind: "idle", text: t("mcpDisabled") };
}

export default function McpPanel({ t }: { t: (key: string) => string }) {
  const [catalogue, setCatalogue] = useState<McpCatalogueEntry[]>([]);
  const [config, setConfig] = useState<Record<string, McpServerConfig>>({});
  const [running, setRunning] = useState<McpServerState[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [shown, setShown] = useState<Shown>("all");
  /** The servers switched on, the same for Chat and every project. */
  const [enabled, setEnabled] = useState<string[]>([]);
  /** The registry dialog: whether it is open, what it searches for, and what it found. */
  const [registryOpen, setRegistryOpen] = useState(false);
  const [words, setWords] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState<McpCatalogueEntry | null>(null);
  const [found, setFound] = useState<RegistryEntry[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [registryError, setRegistryError] = useState<string | null>(null);

  const api = window.electronAPI?.mcp;

  useEffect(() => {
    if (!api) return;

    api.catalogue().then((result) => setCatalogue(result.servers || []));
    api.config().then((result) => setConfig(result.config || {}));
    api.running().then((result) => setRunning(result.servers || []));
    api.enabled().then((result) => setEnabled(result.ids || []));

    const stopWatching = api.onState?.((state) => {
      setRunning(state.servers || []);
    });

    return () => {
      stopWatching?.();
    };
  }, [api]);

  const stateOf = (id: string) => running.find((server) => server.id === id) || null;

  const entryConfig = (id: string): McpServerConfig =>
    config[id] || { enabled: false, env: {}, arguments: {} };

  const persist = async (id: string, next: McpServerConfig) => {
    setConfig((previous) => ({ ...previous, [id]: next }));
    await api?.save(id, next);
  };

  const reload = async () => {
    const [savedConfig, savedCatalogue] = await Promise.all([api?.config(), api?.catalogue()]);
    setConfig(savedConfig?.config ?? {});
    setCatalogue(savedCatalogue?.servers ?? []);
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

    setEnabled((previous) =>
      on
        ? [...new Set([...previous, entry.id])]
        : previous.filter((id) => id !== entry.id),
    );
    await api?.setEnabled(entry.id, on);

    setBusy(entry.id);
    try {
      // `running()` only lists live servers, so a failed start would lose its reason; the reply
      // from `start` carries it, so keep that one.
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

  const forget = async (entry: McpCatalogueEntry) => {
    await api?.forget(entry.id);
    await reload();
    setEnabled((previous) => previous.filter((id) => id !== entry.id));
  };

  const searchRegistry = async (text: string) => {
    if (!text.trim()) return;
    setSearching(true);
    setRegistryError(null);
    try {
      const result = await api?.search(text.trim());
      setFound(result?.entries ?? []);
    } finally {
      setSearching(false);
    }
  };

  /** Opened with words already typed in the list's search, it searches for them straight away. */
  const openRegistry = (text: string) => {
    setRegistryOpen(true);
    setWords(text);
    setFound(null);
    setRegistryError(null);
    void searchRegistry(text);
  };

  const addFromRegistry = async (entry: RegistryEntry) => {
    const saved = await api?.save(entry.id, {
      enabled: false,
      env: {},
      arguments: {},
      ...(entry.package
        ? { package: entry.package, name: entry.name, description: entry.description, docs: entry.docs }
        : {}),
      ...(entry.url ? { url: entry.url, name: entry.name } : {}),
    });
    if (saved && !saved.success) {
      setRegistryError(saved.error || t("couldNotAddServer"));
      return;
    }
    await reload();
    setRegistryOpen(false);
  };

  const wanted = filter.trim().toLowerCase();

  const visible = catalogue.filter((entry) => {
    if (shown !== "all" && enabled.includes(entry.id) !== (shown === "on")) {
      return false;
    }
    if (!wanted) return true;
    return [entry.name, entry.description].some((field) =>
      field.toLowerCase().includes(wanted),
    );
  });

  if (!api) {
    return <p className="text-[13px] text-text-secondary">{t("mcpUnavailable")}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-8 min-w-[180px] flex-1 items-center gap-2 rounded-sm bg-surface-base px-3 text-[13px] text-text-primary shadow-[inset_0_0_0_1px_var(--rule-control)] outline-none focus-within:ring-2 focus-within:ring-focus">
          <Icon name="magnifying-glass" size={14} className="flex-shrink-0 text-text-tertiary" />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t("mcpSearch")}
            aria-label={t("mcpSearch")}
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-text-tertiary"
          />
        </label>
        <SegmentedControl
          size="dense"
          ariaLabel={t("extensionFilter")}
          value={shown}
          onChange={setShown}
          options={[
            { value: "all", label: t("mcpAll") },
            { value: "on", label: t("mcpEnabled") },
            { value: "off", label: t("mcpDisabled") },
          ]}
        />
        <Button variant="secondary" size="dense" icon={<Icon name="plus" size={14} />} onClick={() => openRegistry(wanted)}>
          {t("addFromRegistry")}
        </Button>
      </div>

      {visible.length === 0 ? (
        <p className="px-1 text-[13px] text-text-secondary">{t("mcpNoMatches")}</p>
      ) : (
        <ExtensionList>
          {visible.map((entry) => {
            const current = entryConfig(entry.id);
            const live = stateOf(entry.id);
            const missing = missingFor(entry);
            const open = expanded === entry.id;
            const hasConfig = Boolean(entry.arguments?.length || entry.env?.length);
            const problem =
              live?.status === "error" && live.error
                ? live.error
                : current.enabled && missing.length > 0
                  ? `Not configured yet: ${missing.join(", ")}.`
                  : null;

            // Typing a missing value clears the "not configured" failure it caused.
            const clearStale = () => {
              if (live?.status === "error" && live.error?.startsWith("Not configured yet")) {
                setRunning((previous) => previous.filter((server) => server.id !== entry.id));
              }
            };

            const menu: MenuEntry[] = [
              ...(hasConfig
                ? [{ id: "configure", label: t("mcpConfigure"), icon: <Icon name="sliders-horizontal" size={16} />, onSelect: () => setExpanded(open ? null : entry.id) }]
                : []),
              { id: "docs", label: t("mcpPackageDocs"), icon: <Icon name="arrow-square-out" size={16} />, onSelect: () => window.open(entry.docs, "_blank", "noreferrer") },
              ...(entry.site
                ? [{ id: "site", label: t("mcpWebsite"), icon: <Icon name="arrow-square-out" size={16} />, onSelect: () => window.open(entry.site, "_blank", "noreferrer") }]
                : []),
              ...(entry.source === "registry"
                ? [
                    { type: "separator" as const, id: "sep" },
                    { id: "delete", label: t("delete"), icon: <Icon name="trash" size={16} />, danger: true, onSelect: () => setConfirmingDelete(entry) },
                  ]
                : []),
            ];

            return (
              <ExtensionRow
                key={entry.id}
                leading={<ServerIcon entry={entry} />}
                name={entry.name}
                status={statusOf(current.enabled, live, busy === entry.id, missing, t)}
                meta={entry.package}
                description={entry.description}
                note={
                  <>
                    {entry.caution && <p className="mt-1.5 text-[12px] leading-4 text-warn">{entry.caution}</p>}
                    {problem && (
                      <p role="alert" className="mt-1.5 break-words text-[12px] leading-4 text-danger">
                        {problem}
                      </p>
                    )}
                  </>
                }
                control={
                  <Toggle
                    checked={current.enabled}
                    label={entry.name}
                    onChange={(value) => {
                      // Starting a server that cannot run wastes ten seconds to report what we
                      // already knew.
                      if (value && missing.length > 0) {
                        setExpanded(entry.id);
                        return;
                      }
                      void toggle(entry, value);
                    }}
                  />
                }
                menu={menu}
                menuLabel={fill(t("extensionActions"), { name: entry.name })}
              >
                {open && hasConfig && (
                  <div className="space-y-3 rounded-md bg-surface-raised/60 p-3">
                    {(entry.arguments || []).map((argument) => (
                      <label key={argument.key} className="block">
                        <span className="text-[12px] font-medium text-text-secondary">{argument.label}</span>
                        <input
                          value={
                            argument.multiple
                              ? ((current.arguments[argument.key] as string[]) || []).join("\n")
                              : String(current.arguments[argument.key] || "")
                          }
                          placeholder={argument.placeholder}
                          onChange={(event) => {
                            void persist(entry.id, {
                              ...current,
                              arguments: {
                                ...current.arguments,
                                [argument.key]: argument.multiple
                                  ? event.target.value.split("\n").filter(Boolean)
                                  : event.target.value,
                              },
                            });
                            clearStale();
                          }}
                          className="mt-1 h-8 w-full rounded-sm bg-surface-base px-3 text-[13px] text-text-primary shadow-[inset_0_0_0_1px_var(--rule-control)] placeholder:text-text-tertiary outline-none focus-visible:ring-2 focus-visible:ring-focus"
                        />
                      </label>
                    ))}

                    {(entry.env || []).map((variable) => (
                      <label key={variable.key} className="block">
                        <span className="text-[12px] font-medium text-text-secondary">
                          {variable.label}
                          {!variable.required && ` (${t("optional")})`}
                        </span>
                        <input
                          type={variable.secret ? "password" : "text"}
                          value={String(current.env[variable.key] || "")}
                          onChange={(event) => {
                            void persist(entry.id, {
                              ...current,
                              env: { ...current.env, [variable.key]: event.target.value },
                            });
                            clearStale();
                          }}
                          className="mt-1 h-8 w-full rounded-sm bg-surface-base px-3 text-[13px] text-text-primary shadow-[inset_0_0_0_1px_var(--rule-control)] placeholder:text-text-tertiary outline-none focus-visible:ring-2 focus-visible:ring-focus"
                        />
                      </label>
                    ))}
                  </div>
                )}
              </ExtensionRow>
            );
          })}
        </ExtensionList>
      )}

      {/* The registry, asked only when the user asks: everything above works with no network,
          which is the default Draggy keeps. */}
      {wanted.length > 1 && !registryOpen && (
        <Button variant="ghost" size="dense" icon={<Icon name="magnifying-glass" size={14} />} onClick={() => openRegistry(wanted)}>
          {t("searchRegistry")}
        </Button>
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title={fill(t("deleteServerTitle"), { name: confirmingDelete.name })}
          body={t("deleteServerBody")}
          confirmLabel={t("delete")}
          cancelLabel={t("cancel")}
          onCancel={() => setConfirmingDelete(null)}
          onConfirm={() => {
            const entry = confirmingDelete;
            setConfirmingDelete(null);
            void forget(entry);
          }}
        />
      )}

      <RegistryDialog
        open={registryOpen}
        onClose={() => setRegistryOpen(false)}
        words={words}
        onWords={setWords}
        onSearch={() => void searchRegistry(words)}
        found={found}
        searching={searching}
        problem={registryError}
        onAdd={(entry) => void addFromRegistry(entry)}
        t={t}
      />
    </div>
  );
}

/** Finds a server in the public registry and saves it switched off, so it shows in the list above
 * and waits for its settings and its switch. */
function RegistryDialog({
  open,
  onClose,
  words,
  onWords,
  onSearch,
  found,
  searching,
  problem,
  onAdd,
  t,
}: {
  open: boolean;
  onClose: () => void;
  words: string;
  onWords: (words: string) => void;
  onSearch: () => void;
  found: RegistryEntry[] | null;
  searching: boolean;
  problem: string | null;
  onAdd: (entry: RegistryEntry) => void;
  t: (key: string) => string;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("addFromRegistry")}
      description={t("registryHint")}
      closeLabel={t("closeDialog")}
      width={520}
    >
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch();
        }}
      >
        <input
          data-autofocus
          value={words}
          onChange={(event) => onWords(event.target.value)}
          placeholder={t("mcpSearch")}
          aria-label={t("mcpSearch")}
          className="h-8 min-w-0 flex-1 rounded-sm bg-surface-base px-3 text-[13px] text-text-primary shadow-[inset_0_0_0_1px_var(--rule-control)] placeholder:text-text-tertiary outline-none focus-visible:ring-2 focus-visible:ring-focus"
        />
        <Button type="submit" variant="secondary" size="dense" disabled={searching || !words.trim()}>
          {searching ? t("loading") : t("searchRegistry")}
        </Button>
      </form>

      {problem && (
        <p role="alert" className="mt-3 text-[12px] text-danger">
          {problem}
        </p>
      )}

      {found && found.length === 0 && <p className="mt-3 text-[13px] text-text-secondary">{t("mcpNoMatches")}</p>}

      {found && found.length > 0 && (
        <div className="mt-3 max-h-[320px] divide-y divide-rule overflow-y-auto rounded-md shadow-[0_0_0_1px_var(--rule-strong)]">
          {found.map((entry) => (
            <div key={entry.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2">
                  <span className="truncate text-[13px] font-medium leading-5 text-text-primary">{entry.name}</span>
                  {entry.remote && <span className="flex-shrink-0 text-[11px] text-text-tertiary">{t("remote")}</span>}
                </p>
                <p className="truncate text-[12px] leading-4 text-text-secondary">{entry.description}</p>
              </div>
              <Button variant="secondary" size="dense" onClick={() => onAdd(entry)}>
                {t("addServer")}
              </Button>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}
