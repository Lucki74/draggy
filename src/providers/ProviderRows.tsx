import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ExternalLink, Loader2, Plus, Search } from "lucide-react";
import { Badge, Button, Segmented, Toggle } from "../settings/Controls";
import { engineFailure } from "../ai/engineErrors";
import { failureOf } from "../ai/llamaStream";
import { fill } from "../onboarding/text";
import type { Providers } from "./useProviders";
import type {
  DiscoveredServer,
  ProviderCapability,
  ProviderCatalogEntry,
  ProviderFailure,
  ProviderInstance,
  ProviderModel,
} from "../types";

type Translate = (key: string) => string;

const CAPABILITIES: { flag: ProviderCapability; label: string }[] = [
  { flag: "tools", label: "capabilityTools" },
  { flag: "vision", label: "capabilityVision" },
  { flag: "thinking", label: "capabilityThinking" },
];
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

const hostOf = (baseUrl: string) => {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
};

/** Plain http to anything but this computer: readable by whoever is on the network in between. */
function isUnencrypted(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return url.protocol === "http:" && !LOOPBACK.has(url.hostname);
  } catch {
    return false;
  }
}

function Dot({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`w-2 h-2 rounded-full flex-shrink-0 ${on ? "bg-[var(--text-main)]" : "border-2 border-[var(--text-muted)]"}`}
    />
  );
}

function RowHead({
  on,
  name,
  subtitle,
  children,
}: {
  on: boolean;
  name: string;
  subtitle: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Dot on={on} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold truncate">{name}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-[var(--text-muted)]">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function Expander({ open, onToggle, label }: { open: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={label}
      className="p-2 rounded-lg text-[var(--text-muted)] hover:bg-[var(--hover-bg)] transition-colors"
    >
      <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
  );
}

export function EngineRow({ count, t }: { count: number; t: Translate }) {
  return <RowHead on name={t("draggyEngine")} subtitle={fill(t("engineSubtitle"), { count: String(count) })} />;
}

/** A server found on this computer and not added yet: switching it on adds it. */
export function DiscoveredRow({ server, providers }: { server: DiscoveredServer; providers: Providers }) {
  const [busy, setBusy] = useState(false);
  const turnOn = async () => {
    setBusy(true);
    const added = await providers.add({ type: server.type, baseUrl: server.baseUrl });
    if (added.ok && added.instance) await providers.update(added.instance.id, { enabled: true });
    setBusy(false);
  };
  return (
    <RowHead on={false} name={server.name} subtitle={hostOf(server.baseUrl)}>
      <Toggle checked={false} disabled={busy} onChange={() => void turnOn()} label={server.name} />
    </RowHead>
  );
}

/** A provider the user set up, local or keyed: its switch, and when opened its key, models and more. */
export function InstanceRow({
  instance,
  entry,
  running,
  providers,
  initiallyOpen = false,
  t,
}: {
  instance: ProviderInstance;
  entry: ProviderCatalogEntry | undefined;
  /** For a local server: whether the last scan found it. */
  running?: boolean;
  providers: Providers;
  initiallyOpen?: boolean;
  t: Translate;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [models, setModels] = useState<ProviderModel[] | null>(null);
  const [failure, setFailure] = useState<ProviderFailure | null>(null);
  const [message, setMessage] = useState("");

  const listModels = useCallback(
    async (refresh = false) => {
      const answer = await window.electronAPI?.providers?.models(instance.id, { refresh }).catch(() => null);
      if (answer?.success) {
        setModels(answer.models);
        setFailure(null);
      } else if (answer) {
        setFailure(answer.error);
      }
    },
    [instance.id],
  );

  // Listed only once there is something to show: a provider switched on, or a row opened.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch updates state when models arrive
    if (instance.enabled || open) void listModels();
  }, [instance.enabled, open, instance.hasKey, instance.baseUrl, instance.modelOverrides, listModels]);

  const local = instance.kind === "local";
  const blocked = instance.needsKey && (!instance.hasKey || entry?.available === false);
  const pinned = instance.pinnedModels.length;
  const subtitle = [
    local ? hostOf(instance.baseUrl) : instance.hasKey ? `•••• ${instance.keyHint}` : instance.needsKey ? t("noKeyYet") : hostOf(instance.baseUrl),
    local && running === false ? t("serverNotRunning") : models ? fill(t("pinnedOfModels"), { pinned: String(pinned), count: String(models.length) }) : null,
  ].filter(Boolean);

  const saved = (result: { ok: boolean }) => setMessage(result.ok ? "" : t("providerChangeFailed"));

  return (
    <div>
      <RowHead on={instance.enabled} name={instance.label} subtitle={subtitle.join(" · ")}>
        <Toggle
          checked={instance.enabled}
          disabled={!instance.enabled && blocked}
          onChange={(enabled) => void providers.update(instance.id, { enabled }).then(saved)}
          label={instance.label}
        />
        <Expander open={open} onToggle={() => setOpen((value) => !value)} label={instance.label} />
      </RowHead>

      {open && (
        <div className="px-4 pb-4 ps-9 flex flex-col gap-4">
          {(instance.needsKey || entry?.id === "custom") && (
            <KeyField instance={instance} entry={entry} providers={providers} onSaved={saved} t={t} />
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => {
                setMessage("");
                void window.electronAPI?.providers
                  ?.test(instance.id)
                  .then((answer) => {
                    if (answer.success) {
                      setMessage(fill(t("testPassed"), { count: String(answer.count) }));
                      void listModels();
                    } else {
                      setMessage(engineFailure(failureOf({ ...answer.error, provider: instance.label })));
                    }
                  })
                  .catch(() => undefined);
              }}
            >
              {t("testConnection")}
            </Button>
            {message && <p className="text-xs font-bold text-[var(--text-muted)] break-words min-w-0">{message}</p>}
          </div>

          {failure && !message && (
            <p className="text-xs font-bold text-red-500">{engineFailure(failureOf({ ...failure, provider: instance.label }))}</p>
          )}

          <ModelList instance={instance} models={models} providers={providers} t={t} />

          <Advanced instance={instance} entry={entry} providers={providers} onSaved={saved} t={t} />
        </div>
      )}
    </div>
  );
}

/** Write-only: what is typed goes to the keystore, and only its last four come back. */
function KeyField({
  instance,
  entry,
  providers,
  onSaved,
  t,
}: {
  instance: ProviderInstance;
  entry: ProviderCatalogEntry | undefined;
  providers: Providers;
  onSaved: (result: { ok: boolean }) => void;
  t: Translate;
}) {
  const [draft, setDraft] = useState("");
  const save = () => {
    const key = draft.trim();
    if (!key) return;
    setDraft("");
    void providers.setKey(instance.id, key).then(onSaved);
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-bold text-[var(--text-muted)] w-24 flex-shrink-0">{t("apiKeyLabel")}</span>
      <input
        type="password"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => event.key === "Enter" && save()}
        placeholder={instance.hasKey ? `•••• ${instance.keyHint}` : ""}
        aria-label={`${t("apiKeyLabel")} ${instance.label}`}
        disabled={entry?.available === false}
        className="w-full sm:w-64 px-3 py-2 ui-input text-sm font-bold"
        spellCheck={false}
        autoComplete="off"
      />
      {instance.hasKey && <Button onClick={() => void providers.setKey(instance.id, "").then(onSaved)}>{t("remove")}</Button>}
      {entry?.keyUrl && (
        <a
          href={entry.keyUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-bold text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          {t("getApiKey")}
        </a>
      )}
    </div>
  );
}

/** Ticked models are the only ones the menus offer; each can override what it is said to do. */
function ModelList({
  instance,
  models,
  providers,
  t,
}: {
  instance: ProviderInstance;
  models: ProviderModel[] | null;
  providers: Providers;
  t: Translate;
}) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (models ?? []).filter((model) => !needle || model.id.toLowerCase().includes(needle));
  }, [models, query]);

  if (models === null) return null;
  if (models.length === 0) return <p className="text-xs font-bold text-[var(--text-muted)]">{t("noModelsListed")}</p>;

  const pin = (id: string, on: boolean) => {
    const next = on ? [...instance.pinnedModels, id] : instance.pinnedModels.filter((pinned) => pinned !== id);
    void providers.update(instance.id, { pinnedModels: next });
  };
  const override = (model: ProviderModel, flag: ProviderCapability) => {
    const has = model.capabilities.includes(flag);
    const overrides = { ...instance.modelOverrides, [model.id]: { ...(instance.modelOverrides[model.id] ?? {}), [flag]: !has } };
    void providers.update(instance.id, { modelOverrides: overrides });
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-bold text-[var(--text-muted)]">{t("models")}</p>
      {models.length > 8 && (
        <label className="flex items-center gap-2 px-3 py-2 ui-input">
          <Search className="w-3.5 h-3.5 text-[var(--text-muted)]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchModelsPlaceholder")}
            aria-label={t("searchModelsPlaceholder")}
            className="flex-1 min-w-0 bg-transparent text-sm font-bold outline-none"
          />
        </label>
      )}
      <ul className="flex flex-col max-h-72 overflow-y-auto">
        {shown.map((model) => (
          <li key={model.id} className="flex flex-wrap items-center gap-2 py-1.5">
            <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer">
              <input
                type="checkbox"
                checked={model.pinned}
                onChange={(event) => pin(model.id, event.target.checked)}
                className="accent-[var(--text-main)]"
              />
              <span className="text-sm font-bold truncate" dir="ltr">
                {model.id}
              </span>
              {instance.kind === "local" && model.cloud && <Badge title={t("cloudModelHint")}>{t("cloudModelBadge")}</Badge>}
            </label>
            <div className="flex items-center gap-1">
              {CAPABILITIES.map(({ flag, label }) => {
                const on = model.capabilities.includes(flag);
                return (
                  <button
                    key={flag}
                    type="button"
                    aria-pressed={on}
                    onClick={() => override(model, flag)}
                    className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition-colors ${
                      on
                        ? "bg-[var(--bg-inverted)] text-[var(--text-inverted)] border-transparent"
                        : "text-[var(--text-muted)] border-[var(--border-light)] hover:text-[var(--text-main)]"
                    }`}
                  >
                    {t(label)}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The address, extra headers and prompt profile, and removing the provider. */
function Advanced({
  instance,
  entry,
  providers,
  onSaved,
  t,
}: {
  instance: ProviderInstance;
  entry: ProviderCatalogEntry | undefined;
  providers: Providers;
  onSaved: (result: { ok: boolean }) => void;
  t: Translate;
}) {
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState(instance.baseUrl);
  const headerText = Object.entries(instance.headers ?? {})
    .map(([name, value]) => `${name}: ${value}`)
    .join("\n");
  const [headers, setHeaders] = useState(headerText);

  const saveHeaders = () => {
    if (headers === headerText) return;
    const parsed: Record<string, string> = {};
    for (const line of headers.split("\n")) {
      const colon = line.indexOf(":");
      if (colon > 0) parsed[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
    }
    void providers.update(instance.id, { headers: parsed }).then(onSaved);
  };

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="self-start inline-flex items-center gap-1 text-xs font-bold text-[var(--text-muted)] hover:text-[var(--text-main)]"
      >
        {t("advancedSettings")}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <>
          {entry?.editableBaseUrl && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-[var(--text-muted)]">{t("providerAddress")}</span>
              <input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                onBlur={() => address !== instance.baseUrl && void providers.update(instance.id, { baseUrl: address }).then(onSaved)}
                dir="ltr"
                className="w-full px-3 py-2 ui-input text-sm font-bold"
                spellCheck={false}
              />
              {isUnencrypted(address) && <span className="text-[11px] font-bold text-red-500">{t("unencryptedAddress")}</span>}
            </label>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold text-[var(--text-muted)]">{t("providerHeaders")}</span>
            <textarea
              value={headers}
              onChange={(event) => setHeaders(event.target.value)}
              onBlur={saveHeaders}
              rows={2}
              dir="ltr"
              placeholder={t("providerHeadersHint")}
              className="w-full px-3 py-2 ui-input text-sm font-bold resize-y"
              spellCheck={false}
            />
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-bold text-[var(--text-muted)]">{t("promptProfile")}</span>
            <Segmented
              label={t("promptProfile")}
              value={instance.promptProfile}
              options={[
                { id: "auto", label: t("automatic") },
                { id: "compact", label: t("promptCompact") },
                { id: "full", label: t("promptFull") },
              ]}
              onChange={(promptProfile) => void providers.update(instance.id, { promptProfile }).then(onSaved)}
            />
            <span className="text-[11px] font-bold text-[var(--text-muted)]">{t("promptProfileHint")}</span>
          </div>

          <div>
            <Button tone="danger" onClick={() => void providers.remove(instance.id)}>
              {t("remove")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** The catalog, searchable; picking one adds it switched off, to be keyed and switched on. */
export function AddProvider({
  catalog,
  providers,
  onAdded,
  t,
}: {
  catalog: ProviderCatalogEntry[];
  providers: Providers;
  onAdded: (id: string) => void;
  t: Translate;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const needle = query.trim().toLowerCase();
  const shown = catalog.filter((entry) => !needle || entry.name.toLowerCase().includes(needle));

  if (!open) {
    return (
      <div className="px-4 py-3">
        <Button onClick={() => setOpen(true)}>
          <span className="inline-flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" />
            {t("addProvider")}
          </span>
        </Button>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 flex flex-col gap-2">
      <label className="flex items-center gap-2 px-3 py-2 ui-input">
        <Search className="w-3.5 h-3.5 text-[var(--text-muted)]" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("searchProviders")}
          aria-label={t("searchProviders")}
          className="flex-1 min-w-0 bg-transparent text-sm font-bold outline-none"
        />
        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      </label>
      <ul className="flex flex-col max-h-64 overflow-y-auto">
        {shown.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const added = await providers.add({ type: entry.id });
                setBusy(false);
                if (added.ok && added.instance) {
                  setOpen(false);
                  setQuery("");
                  onAdded(added.instance.id);
                }
              }}
              className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-start hover:bg-[var(--hover-bg)] transition-colors"
            >
              <span className="flex-1 min-w-0 truncate text-sm font-bold">{entry.name}</span>
              {entry.kind === "local" && <Badge>{t("onThisComputer")}</Badge>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
