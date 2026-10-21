import { useEffect, useState } from "react";
import { Button, ConfirmDialog, Group, Page, Row, Segmented, Select, Stat, Toggle } from "./Controls";
import { AccentPicker } from "./AccentPicker";
import { ProgressLine } from "../ui/ProgressLine";
import { ReleaseNotes } from "../updates/ReleaseNotes";
import { buildLabel } from "../app/buildLabel";
import ExtensionsPanel from "../extensions/ExtensionsPanel";
import { languages } from "../translations";
import { searchProviderOptions } from "./pages";
import type { AppSettings, Language, SearchProvider, StorageStats, UpdaterState } from "../types";
import { swallowed } from "../logger";

type Translate = (key: string) => string;

interface SettingsProps {
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
  t: Translate;
}

/** The pages about the app as a whole: how it looks, where searches go, what it keeps, updates. */

export function GeneralPage({ settings, onUpdate, t }: SettingsProps) {
  const [confirmSetup, setConfirmSetup] = useState(false);

  return (
    <Page title={t("settingsGeneral")}>
      <Group title={t("appearance")}>
        <Row label={t("theme")}>
          <Segmented
            label={t("theme")}
            value={settings.theme}
            options={[
              { id: "light", label: t("light") },
              { id: "dark", label: t("dark") },
              { id: "system", label: t("themeSystem") },
            ]}
            onChange={(theme) => onUpdate({ theme })}
          />
        </Row>
        <Row label={t("accentColor")}>
          <AccentPicker value={settings.accent} onChange={(accent) => onUpdate({ accent })} t={t} />
        </Row>
        <Row label={t("textSize")}>
          <Segmented
            label={t("textSize")}
            value={settings.fontSize}
            options={[
              { id: "sm", label: t("textSmall") },
              { id: "base", label: t("textMedium") },
              { id: "lg", label: t("textLarge") },
            ]}
            onChange={(fontSize) => onUpdate({ fontSize })}
          />
        </Row>
      </Group>

      <Group>
        <Row label={t("language")}>
          <Select
            label={t("language")}
            value={settings.language}
            options={languages.map((one) => ({ id: one.code, label: one.name }))}
            onChange={(language) => onUpdate({ language: language as Language })}
          />
        </Row>
        <Row label={t("showMetrics")}>
          <Toggle
            label={t("showMetrics")}
            checked={settings.showMetrics}
            onChange={(showMetrics) => onUpdate({ showMetrics, metricsChosen: true })}
          />
        </Row>
      </Group>

      <Group>
        <Row label={t("onbRunAgain")} description={t("onbRunAgainHint")}>
          <Button onClick={() => setConfirmSetup(true)}>{t("onbRunAgainButton")}</Button>
        </Row>
      </Group>

      {confirmSetup && (
        <ConfirmDialog
          title={t("onbRunAgain")}
          body={t("onbRunAgainBody")}
          confirmLabel={t("onbRunAgainConfirm")}
          cancelLabel={t("cancel")}
          tone="primary"
          onConfirm={() => {
            setConfirmSetup(false);
            void window.electronAPI?.onboarding?.reset();
          }}
          onCancel={() => setConfirmSetup(false)}
        />
      )}
    </Page>
  );
}

export function WebSearchPage({ settings, onUpdate, t }: SettingsProps) {
  const provider = settings.searchProvider;

  return (
    <Page title={t("webSearchPage")}>
      <Group>
        <Row label={t("searchProvider")} description={t("searchProviderHint")}>
          <Select
            label={t("searchProvider")}
            value={provider}
            options={searchProviderOptions(t)}
            onChange={(searchProvider) => onUpdate({ searchProvider: searchProvider as SearchProvider })}
          />
        </Row>

        {(provider === "auto" || provider === "searxng") && (
          <Row label={t("searxngUrl")}>
            <input
              type="text"
              value={settings.searxngUrl}
              onChange={(event) => onUpdate({ searxngUrl: event.target.value })}
              placeholder="http://localhost:8080"
              aria-label={t("searxngUrl")}
              className="h-8 w-full sm:w-64 rounded-sm bg-surface-base px-3 text-[13px] text-text-primary shadow-[inset_0_0_0_1px_var(--rule-control)] placeholder:text-text-tertiary outline-none focus-visible:ring-2 focus-visible:ring-focus"
              spellCheck={false}
            />
          </Row>
        )}

        {(provider === "auto" || provider === "brave") && (
          <BraveKeyRow t={t} />

        )}
      </Group>
    </Page>
  );
}

export function ExtensionsPage({ t }: { t: Translate }) {
  return (
    <Page title={t("extensions")}>
      <ExtensionsPanel t={t} />
    </Page>
  );
}

interface DataPageProps {
  t: Translate;
  onClearChats: () => void;
  onClearSessions: () => void;
}

export function DataPage({ t, onClearChats, onClearSessions }: DataPageProps) {
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [confirming, setConfirming] = useState<"chats" | "sessions" | null>(null);

  useEffect(() => {
    let current = true;
    window.electronAPI?.db
      .stats()
      .then((result) => {
        if (current) setStats(result?.stats ?? null);
      })
      .catch(swallowed("settings", "the main process already logged this call"));
    return () => {
      current = false;
    };
  }, [confirming]);

  return (
    <Page title={t("data")}>
      {stats && (
        <section className="space-y-2">
          <h3 className="text-[13px] font-medium leading-5 text-text-secondary">
            {t("storedOnDisk")}
          </h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={t("conversations")} value={String(stats.chats)} />
            <Stat label={t("messages")} value={String(stats.messages)} />
            <Stat label={t("attachments")} value={String(stats.attachments)} />
            <Stat
              label={t("attachmentSize")}
              value={`${(stats.attachmentBytes / 1024 ** 2).toFixed(1)} MB`}
            />
          </div>
        </section>
      )}

      <Group title={t("eraseData")} danger>
        <Row label={t("clearChats")} description={t("clearChatsHint")}>
          <Button tone="danger" onClick={() => setConfirming("chats")}>
            {t("delete")}
          </Button>
        </Row>
        <Row label={t("clearSessions")} description={t("clearSessionsHint")}>
          <Button tone="danger" onClick={() => setConfirming("sessions")}>
            {t("delete")}
          </Button>
        </Row>
      </Group>

      {confirming && (
        <ConfirmDialog
          title={confirming === "chats" ? t("clearChats") : t("clearSessions")}
          body={confirming === "chats" ? t("confirmClearChats") : t("confirmClearSessions")}
          confirmLabel={t("delete")}
          cancelLabel={t("cancel")}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            if (confirming === "chats") onClearChats();
            else onClearSessions();
            setConfirming(null);
          }}
        />
      )}
    </Page>
  );
}

export function UpdatesPage({ settings, onUpdate, t }: SettingsProps) {
  const [state, setState] = useState<UpdaterState | null>(null);
  const [info, setInfo] = useState<{ version: string; packaged: boolean } | null>(null);

  useEffect(() => {
    const api = window.electronAPI?.updater;
    if (!api) return;

    api.state().then(setState).catch(swallowed("settings", "the main process already logged this call"));
    return api.onState(setState);
  }, []);

  useEffect(() => {
    window.electronAPI
      ?.appInfo()
      .then((result) => setInfo({ version: result.version, packaged: result.packaged }))
      .catch(swallowed("settings", "the main process already logged this call"));
  }, []);

  // Looking at this page is a good moment to check, when the user lets Draggy check at all.
  useEffect(() => {
    if (!settings.autoUpdate) return;
    window.electronAPI?.updater.check({ silent: true }).catch(swallowed("settings", "the main process already logged this call"));
  }, [settings.autoUpdate]);

  const status = state?.status ?? "idle";
  const percent = Math.min(100, Math.max(0, state?.percent ?? 0));

  const message =
    status === "disabled"
      ? t("updatesUnavailable")
      : status === "checking"
        ? t("checkingForUpdates")
        : status === "available"
          ? `${t("updateAvailable")} ${buildLabel(state?.version, t)}`
          : status === "downloading"
            ? `${t("downloading")} ${percent}%`
            : status === "ready"
              ? `${t("updateReady")} ${buildLabel(state?.version, t)}`
              : status === "error"
                ? state?.error || t("updateFailed")
                : status === "current"
                  ? t("upToDate")
                  : t("notChecked");

  return (
    <Page title={t("updates")}>
      <Group>
        <Row label={t("currentVersion")}>
          <p className="text-[13px] font-medium tabular-nums text-text-primary">
            {info ? buildLabel(info.version, t) : "…"}
            {info && !info.packaged && (
              <span className="ms-2 rounded-pill bg-surface-raised px-2 py-0.5 text-[11px] font-medium text-text-secondary">
                {t("development")}
              </span>
            )}
          </p>
        </Row>
        <Row label={t("automaticUpdates")}>
          <Toggle
            label={t("automaticUpdates")}
            checked={settings.autoUpdate}
            onChange={(autoUpdate) => onUpdate({ autoUpdate })}
          />
        </Row>
        <Row
          label={t("updateStatus")}
          description={
            <>
              <span role="status">{message}</span>
              {status === "downloading" && (
                <div className="mt-2">
                  <ProgressLine progress={percent / 100} label={message} />
                </div>
              )}
            </>
          }
        >
          <div className="flex gap-2">
            <Button
              onClick={() => void window.electronAPI?.updater.check()}
              disabled={status === "checking" || status === "disabled"}
            >
              {t("checkNow")}
            </Button>
            {status === "available" && (
              <Button tone="primary" onClick={() => void window.electronAPI?.updater.download()}>
                {t("download")}
              </Button>
            )}
            {status === "ready" && (
              <Button tone="primary" onClick={() => void window.electronAPI?.updater.install()}>
                {t("restartAndInstall")}
              </Button>
            )}
          </div>
        </Row>
      </Group>
      {(status === "available" || status === "downloading" || status === "ready") && (
        <div className="mt-4">
          <ReleaseNotes notes={state?.notes ?? null} t={t} showEmpty />
        </div>
      )}
    </Page>
  );
}

type BraveKeyStatus = Awaited<ReturnType<NonNullable<Window["electronAPI"]>["braveKeyStatus"]>>;

/** Write-only, like a provider's key: what is typed goes to the keystore, and only its last four come back. */
function BraveKeyRow({ t }: { t: Translate }) {
  const [status, setStatus] = useState<BraveKeyStatus | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    window.electronAPI?.braveKeyStatus?.().then(setStatus).catch(swallowed("settings", "the main process already logged this call"));
  }, []);

  const save = async (value: string) => {
    const api = window.electronAPI;
    if (!api?.setBraveKey) return;
    await api.setBraveKey(value).catch(swallowed("settings", "the main process already logged this call"));
    setDraft("");
    setStatus(await api.braveKeyStatus().catch(swallowed("settings", "the main process already logged this call", null)));
  };

  return (
    <Row label={t("braveApiKey")} description={status && !status.keystore ? t("braveKeyThisRun") : undefined}>
      <div className="flex w-full items-center gap-2 sm:w-auto">
        <input
          type="password"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => draft.trim() && void save(draft)}
          onKeyDown={(event) => event.key === "Enter" && draft.trim() && void save(draft)}
          placeholder={status?.hasKey ? `•••• ${status.keyHint}` : "BSA..."}
          aria-label={t("braveApiKey")}
          className="h-8 w-full sm:w-64 rounded-sm bg-surface-base px-3 text-[13px] text-text-primary shadow-[inset_0_0_0_1px_var(--rule-control)] placeholder:text-text-tertiary outline-none focus-visible:ring-2 focus-visible:ring-focus"
          spellCheck={false}
          autoComplete="off"
        />
        {status?.hasKey && <Button onClick={() => void save("")}>{t("remove")}</Button>}
      </div>
    </Row>
  );
}