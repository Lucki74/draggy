import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ExternalLink, Loader2, Plus, Search } from "lucide-react";
import { Badge, Button, Segmented, Toggle } from "../settings/Controls";
import { engineFailure } from "../ai/engineErrors";
import { failureOf } from "../ai/llamaStream";
import { fill } from "../onboarding/text";
import { VENDOR_NAMES } from "./vendors";
import { ProviderIcon } from "./ProviderIcon";
import Logo from "../Logo";
import { accountSubtitle } from "./accountSubtitle";
import type { Providers } from "./useProviders";
import type {
  AccountProgress,
  AccountStatus,
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
  icon,
  name,
  subtitle,
  children,
}: {
  on: boolean;
  icon: React.ReactNode;
  name: string;
  subtitle: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Dot on={on} />
      {icon}
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
  return <RowHead on icon={<Logo className="w-5 h-5 flex-shrink-0 text-[var(--text-main)]" />} name={t("draggyEngine")} subtitle={fill(t("engineSubtitle"), { count: String(count) })} />;
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
    <RowHead on={false} icon={<ProviderIcon type={server.type} name={server.name} />} name={server.name} subtitle={hostOf(server.baseUrl)}>
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
      <RowHead
        on={instance.enabled}
        icon={<ProviderIcon type={instance.type} name={instance.label} />}
        name={instance.label}
        subtitle={
          <>
            {subtitle.join(" · ")}
            {instance.newModels?.length > 0 && <Badge>{t("newModelsBadge")}</Badge>}
          </>
        }
      >
        <Toggle
          checked={instance.enabled}
          disabled={!instance.enabled && blocked}
          onChange={(enabled) => void providers.update(instance.id, { enabled }).then(saved)}
          label={instance.label}
        />
        <Expander open={open} onToggle={() => setOpen((value) => !value)} label={instance.label} />
      </RowHead>

      {open && (
        <div className="px-4 pb-4 ps-[68px] flex flex-col gap-4">
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

type SignInStep = { step: "starting" } | AccountProgress;

/** The code Google shows once the page is done: handed to the runtime once, and kept nowhere here. */
function CodeEntry({ id, t }: { id: string; t: Translate }) {
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const send = async () => {
    const value = code.trim();
    if (!value) return;
    setCode("");
    setSent(true);
    const answer = await window.electronAPI?.providers?.accountSubmitCode(id, value).catch(() => null);
    if (!answer?.success || !answer.accepted) setSent(false);
  };
  if (sent) return null;
  return (
    <>
      <input
        value={code}
        onChange={(event) => setCode(event.target.value)}
        onKeyDown={(event) => event.key === "Enter" && void send()}
        placeholder={t("signInCodePrompt")}
        aria-label={t("signInCodePrompt")}
        className="w-full sm:w-64 px-3 py-2 ui-input text-sm font-bold"
        spellCheck={false}
        autoComplete="off"
      />
      <Button tone="primary" onClick={() => void send()} disabled={!code.trim()}>
        {t("confirm")}
      </Button>
    </>
  );
}

/** A plan reached through the vendor's own runtime: signed in there, never with a key, and read on open only. */
export function AccountRow({
  entry,
  instance,
  providers,
  register,
  note,
  t,
}: {
  entry: ProviderCatalogEntry;
  instance: ProviderInstance | undefined;
  providers: Providers;
  /** Where the Add list finds this row when its plan is picked. */
  register?: (id: string, begin: (() => void) | null) => void;
  /** A line shown above the models once signed in. */
  note?: string;
  t: Translate;
}) {
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [signIn, setSignIn] = useState<SignInStep | null>(null);
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ProviderModel[] | null>(null);
  const [message, setMessage] = useState("");
  // Each address the runtime prints asks for a fresh code, even when it repeats the last one.
  const [asks, setAsks] = useState(0);
  // The catalog's size was read at load; a sign-in here has since put the runtime on disk.
  const [fetched, setFetched] = useState(false);
  const id = instance?.id;
  const signedIn = Boolean(status?.signedIn);

  useEffect(() => {
    if (!id) return;
    let live = true;
    void window.electronAPI?.providers
      ?.accountStatus(id)
      .then((answer) => {
        // A read begun as the row was added can land after its sign-in, and must not undo it.
        if (live && answer.success) setStatus((now) => (now?.signedIn ? now : answer.status));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [id]);

  useEffect(() => {
    if (!id || !signedIn || !(open || instance?.enabled)) return;
    let live = true;
    void window.electronAPI?.providers
      ?.models(id)
      .then((answer) => {
        if (live && answer.success) setModels(answer.models);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [id, signedIn, open, instance?.enabled, instance?.modelOverrides]);

  const start = async () => {
    const api = window.electronAPI?.providers;
    setMessage("");
    setSignIn({ step: "starting" });
    let target = instance;
    if (!target) {
      const added = await providers.add({ type: entry.id });
      target = added.ok ? added.instance : undefined;
    }
    if (!api || !target) {
      setSignIn(null);
      setMessage(t("signInFailed"));
      return;
    }
    const targetId = target.id;
    const stop = api.onAccountProgress((progress) => {
      if (progress.id !== targetId) return;
      if (progress.step === "code") setAsks((n) => n + 1);
      setSignIn(progress);
    });
    const answer = await api.accountSignIn(targetId).catch(() => null);
    stop();
    setSignIn(null);
    if (answer?.success && answer.status.signedIn) {
      setStatus(answer.status);
      // An account has no default models, so the first sign-in ticks what the plan offers.
      const listed = target.pinnedModels.length ? null : await api.models(targetId).catch(() => null);
      const pinnedModels = listed?.success ? listed.models.map((model) => model.id) : target.pinnedModels;
      await providers.update(targetId, { enabled: true, pinnedModels });
      setOpen(true);
      setFetched(true);
    } else if (answer && !answer.success) {
      setMessage(engineFailure(failureOf({ ...answer.error, provider: entry.name })));
    } else if (!answer?.status.cancelled) {
      setMessage(t("signInFailed"));
    }
  };

  // A plan picked in the Add list opens this row if signed in, or starts its sign-in.
  const begin = () => (signedIn ? setOpen(true) : !signIn && void start());
  useEffect(() => {
    register?.(entry.id, begin);
    return () => register?.(entry.id, null);
  });

  const signOut = async () => {
    if (!id) return;
    await window.electronAPI?.providers?.accountSignOut(id).catch(() => null);
    setStatus({ signedIn: false });
    setModels(null);
    setOpen(false);
    await providers.update(id, { enabled: false });
  };

  const label = instance?.label ?? entry.name;
  return (
    <div>
      <RowHead on={Boolean(instance?.enabled && signedIn)} icon={<ProviderIcon type={entry.id} name={label} />} name={label} subtitle={accountSubtitle(status, t)}>
        {instance && signedIn && (
          <>
            <Toggle checked={instance.enabled} onChange={(enabled) => void providers.update(instance.id, { enabled })} label={label} />
            <Expander open={open} onToggle={() => setOpen((value) => !value)} label={label} />
          </>
        )}
      </RowHead>

      {!signedIn && (
        <div className="px-4 pb-3 ps-[68px] flex flex-wrap items-center gap-2">
          {signIn ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
              {signIn.step === "installing" && (
                <span className="text-xs font-bold text-[var(--text-muted)]">
                  {fill(t("installingRuntime"), { name: entry.name, percent: String(Math.round(signIn.percent)) })}
                </span>
              )}
              {signIn.step === "browser" && <span className="text-xs font-bold text-[var(--text-muted)]">{t("finishInBrowser")}</span>}
              {signIn.step === "code" && id && <CodeEntry key={asks} id={id} t={t} />}
              {id && <Button onClick={() => void window.electronAPI?.providers?.accountCancel(id)}>{t("cancel")}</Button>}
              {signIn.step === "installing" && (
                <div
                  role="progressbar"
                  aria-label={entry.name}
                  aria-valuenow={Math.round(signIn.percent)}
                  className="basis-full h-2 rounded-full overflow-hidden bg-[var(--hover-bg)]"
                >
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{ width: `${Math.min(100, Math.max(0, signIn.percent))}%`, background: "var(--text-main)" }}
                  />
                </div>
              )}
            </>
          ) : (
            <>
              <Button onClick={() => void start()}>{fill(t("signInWith"), { name: entry.name })}</Button>
              {entry.download && !fetched && (
                <span className="text-xs font-bold text-[var(--text-muted)]">
                  {fill(t("onbSourceDownload"), { size: `${Math.round(entry.download / 1e6)} MB` })}
                </span>
              )}
            </>
          )}
          {message && <p className="text-xs font-bold text-red-500 break-words min-w-0">{message}</p>}
        </div>
      )}

      {open && instance && signedIn && (
        <div className="px-4 pb-4 ps-[68px] flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {status?.email && (
              <span className="text-xs font-bold text-[var(--text-muted)]">{fill(t("signedInAs"), { email: status.email })}</span>
            )}
            <Button onClick={() => void signOut()}>{t("signOut")}</Button>
          </div>
          {note && <p className="text-[11px] font-bold text-[var(--text-muted)]">{note}</p>}
          <ModelList instance={instance} models={models} providers={providers} t={t} />
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
  onPlan,
  t,
}: {
  catalog: ProviderCatalogEntry[];
  providers: Providers;
  onAdded: (id: string) => void;
  /** Where a plan is signed in to; without one, a vendor with a plan goes straight to its key. */
  onPlan?: (accountId: string) => void;
  t: Translate;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<ProviderCatalogEntry | null>(null);
  const [choosing, setChoosing] = useState<{ key: ProviderCatalogEntry; plan: ProviderCatalogEntry } | null>(null);
  const needle = query.trim().toLowerCase();
  // Accounts are signed in to from their own group, never added with a key.
  const shown = catalog.filter((entry) => entry.kind !== "account" && (!needle || entry.name.toLowerCase().includes(needle)));

  const planOf = (entry: ProviderCatalogEntry) =>
    onPlan && entry.vendor ? catalog.find((other) => other.kind === "account" && other.vendor === entry.vendor) : undefined;
  const byKey = (entry: ProviderCatalogEntry) => (entry.remote ? setConfirming(entry) : void add(entry));
  const pick = (entry: ProviderCatalogEntry) => {
    const plan = planOf(entry);
    setConfirming(null);
    if (plan) setChoosing({ key: entry, plan });
    else byKey(entry);
  };
  const close = () => {
    setOpen(false);
    setQuery("");
    setChoosing(null);
  };

  const add = async (entry: ProviderCatalogEntry) => {
    setBusy(true);
    const added = await providers.add({ type: entry.id });
    setBusy(false);
    setConfirming(null);
    if (added.ok && added.instance) {
      close();
      onAdded(added.instance.id);
    }
  };

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
              onClick={() => pick(entry)}
              className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-start hover:bg-[var(--hover-bg)] transition-colors"
            >
              <ProviderIcon type={entry.id} name={entry.name} />
              <span className="flex-1 min-w-0 truncate text-sm font-bold">{entry.name}</span>
              {entry.kind === "local" && <Badge>{t("onThisComputer")}</Badge>}
            </button>
          </li>
        ))}
      </ul>
      {choosing && (
        <div role="group" aria-label={choosing.key.name} className="flex flex-col gap-1 px-2 py-2">
          {/* Neither way is marked recommended: the lines say what each costs (spec §7.1). */}
          <button
            type="button"
            onClick={() => {
              onPlan?.(choosing.plan.id);
              close();
            }}
            className="w-full flex flex-col items-start px-2 py-2 rounded-lg text-start hover:bg-[var(--hover-bg)] transition-colors"
          >
            <span className="text-sm font-bold">{t("planRoute")}</span>
            <span className="text-[11px] font-bold text-[var(--text-muted)]">{t("planRouteBody")}</span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setChoosing(null);
              byKey(choosing.key);
            }}
            className="w-full flex flex-col items-start px-2 py-2 rounded-lg text-start hover:bg-[var(--hover-bg)] transition-colors"
          >
            <span className="text-sm font-bold">{t("keyRoute")}</span>
            <span className="text-[11px] font-bold text-[var(--text-muted)]">
              {fill(t("keyRouteBody"), { name: VENDOR_NAMES[choosing.key.vendor ?? "openai"] })}
            </span>
          </button>
        </div>
      )}
      {confirming && (
        <div role="alertdialog" aria-label={confirming.name} className="flex flex-col gap-2 px-2 py-2">
          <p className="text-[11px] font-bold text-[var(--text-muted)]">{fill(t("remoteProviderNotice"), { name: confirming.name })}</p>
          <p className="text-xs font-bold font-mono break-all">{confirming.baseUrl}</p>
          <div className="flex gap-2">
            <Button onClick={() => void add(confirming)}>{t("confirm")}</Button>
            <Button onClick={() => setConfirming(null)}>{t("cancel")}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
