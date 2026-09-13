import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { Button, ConfirmDialog, Group, Page, Row, Segmented, Select, Stat, Toggle } from "./Controls";
import ExtensionsPanel from "../extensions/ExtensionsPanel";
import { languages } from "../translations";
import type { AppSettings, SearchProvider, StorageStats, UpdaterState } from "../types";

type Translate = (key: string) => string;

interface SettingsProps {
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
  t: Translate;
}

/** The pages about the app as a whole: how it looks, where searches go, what it keeps, updates. */

export function GeneralPage({ settings, onUpdate, t }: SettingsProps) {
  return (
    <Page title={t("settingsGeneral")} description={t("settingsGeneralHint")}>
      <Group title={t("appearance")}>
        <Row label={t("theme")}>
          <Segmented
            label={t("theme")}
            value={settings.theme}
            options={[
              { id: "light", label: t("light") },
              { id: "dark", label: t("dark") },
            ]}
            onChange={(theme) => onUpdate({ theme })}
          />
        </Row>
        <Row label={t("textSize")} description={t("textSizeHint")}>
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
        <Row label={t("language")} description={t("languageHint")}>
          <Select
            label={t("language")}
            value={settings.language}
            options={languages.map((one) => ({ id: one.code, label: one.name }))}
            onChange={(language) => onUpdate({ language })}
          />
        </Row>
        <Row label={t("showMetrics")} description={t("showMetricsHint")}>
          <Toggle
            label={t("showMetrics")}
            checked={settings.showMetrics}
            onChange={(showMetrics) => onUpdate({ showMetrics })}
          />
        </Row>
      </Group>
    </Page>
  );
}

const PROVIDERS: SearchProvider[] = ["auto", "brave-html", "duckduckgo", "startpage", "brave", "searxng"];

export function WebSearchPage({ settings, onUpdate, t }: SettingsProps) {
  const provider = settings.searchProvider;

  return (
    <Page title={t("webSearchPage")} description={t("webSearchHint")}>
      <Group>
        <Row label={t("searchProvider")} description={t("searchProviderHint")}>
          <Select
            label={t("searchProvider")}
            value={provider}
            options={PROVIDERS.map((id) => ({ id, label: t(`provider_${id.replace(/-/g, "_")}`) }))}
            onChange={(searchProvider) => onUpdate({ searchProvider: searchProvider as SearchProvider })}
          />
        </Row>

        {(provider === "auto" || provider === "searxng") && (
          <Row label={t("searxngUrl")} description={t("searxngUrlHint")}>
            <input
              type="text"
              value={settings.searxngUrl}
              onChange={(event) => onUpdate({ searxngUrl: event.target.value })}
              placeholder="http://localhost:8080"
              aria-label={t("searxngUrl")}
              className="w-full sm:w-64 px-3 py-2 ui-input text-sm font-bold"
              spellCheck={false}
            />
          </Row>
        )}

        {(provider === "auto" || provider === "brave") && (
          <Row label={t("braveApiKey")} description={t("braveApiKeyHint")}>
            <input
              type="password"
              value={settings.braveApiKey}
              onChange={(event) => onUpdate({ braveApiKey: event.target.value })}
              placeholder="BSA..."
              aria-label={t("braveApiKey")}
              className="w-full sm:w-64 px-3 py-2 ui-input text-sm font-bold"
              spellCheck={false}
            />
          </Row>
        )}
      </Group>
    </Page>
  );
}

export function ExtensionsPage({ t }: { t: Translate }) {
  return (
    <Page title={t("extensions")} description={t("extensionsHint")}>
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
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [confirming]);

  return (
    <Page title={t("data")} description={t("dataHint")}>
      {stats && (
        <section className="space-y-2">
          <h3 className="px-1 text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
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

      <Group>
        <Row label={t("diagnostics")} description={t("diagnosticsHint")}>
          <Button onClick={() => window.electronAPI?.openLogs()}>
            <FileText className="w-4 h-4" />
            {t("openLogFolder")}
          </Button>
        </Row>
      </Group>

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

    api.state().then(setState).catch(() => undefined);
    return api.onState(setState);
  }, []);

  useEffect(() => {
    window.electronAPI
      ?.appInfo()
      .then((result) => setInfo({ version: result.version, packaged: result.packaged }))
      .catch(() => undefined);
  }, []);

  // Looking at this page is a good moment to check, when the user lets Draggy check at all.
  useEffect(() => {
    if (!settings.autoUpdate) return;
    window.electronAPI?.updater.check({ silent: true }).catch(() => undefined);
  }, [settings.autoUpdate]);

  const status = state?.status ?? "idle";
  const percent = Math.min(100, Math.max(0, state?.percent ?? 0));

  const message =
    status === "disabled"
      ? t("updatesUnavailable")
      : status === "checking"
        ? t("checkingForUpdates")
        : status === "available"
          ? `${t("updateAvailable")} v${state?.version}`
          : status === "downloading"
            ? `${t("downloading")} ${percent}%`
            : status === "ready"
              ? `${t("updateReady")} v${state?.version}`
              : status === "error"
                ? state?.error || t("updateFailed")
                : status === "current"
                  ? t("upToDate")
                  : t("notChecked");

  return (
    <Page title={t("updates")}>
      <Group>
        <Row label={t("currentVersion")}>
          <p className="text-sm font-bold tabular-nums">
            {info ? `v${info.version}` : "…"}
            {info && !info.packaged && (
              <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                {t("development")}
              </span>
            )}
          </p>
        </Row>
        <Row label={t("automaticUpdates")} description={t("automaticUpdatesHint")}>
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
                <span className="mt-2 block h-2 rounded-full overflow-hidden bg-[var(--hover-bg)]">
                  <span
                    className="block h-full rounded-full transition-all duration-300"
                    style={{ width: `${percent}%`, background: "var(--text-main)" }}
                  />
                </span>
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
    </Page>
  );
}
