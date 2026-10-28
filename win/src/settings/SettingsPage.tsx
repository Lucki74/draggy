import { useCallback, useEffect, useRef, useState } from "react";
import { logBreadcrumb } from "../logger";
import { Block, Group, Page } from "./Controls";
import { SETTINGS_GROUPS, searchSettings, type SettingsPageEntry, type SettingsTab } from "./pages";
import { useModelManager } from "./useModelManager";
import ModelsPage from "./ModelsPage";
import ProvidersPage from "./ProvidersPage";
import { DiagnosticsPage } from "./DiagnosticsPage";
import { DataPage, ExtensionsPage, GeneralPage, UpdatesPage, WebSearchPage } from "./GeneralPages";
import { ChatPreferencesPage, LibraryPage, TalkPage } from "./ChatPages";
import { CodePreferencesPage, PermissionsPage, ProjectsPage } from "./CodePages";
import ApiServerField from "./ApiServerField";
import StatsPanel from "../stats/StatsPanel";
import { useTranslator } from "../i18n";
import { Icon } from "../ui/icons/Icon";
import { fill } from "../onboarding/text";
import type { AppSettings, PermissionMode, Workspace, WorkspaceGrant } from "../types";

export interface SettingsRequest {
  tab: SettingsTab;
  /** Bumped on every request, so asking for the page already open still lands on it. */
  id: number;
}

interface SettingsPageProps {
  settings: AppSettings;
  /** The model Chat is running. */
  chatModel: string;
  request: SettingsRequest;
  onUpdate: (patch: Partial<AppSettings>) => void;
  onSelectChatModel: (name: string) => void;
  projects: Workspace[];
  /** The project open in Code, if any. */
  activeProjectId: string | null;
  onAddProject: () => Promise<Workspace | null>;
  onRenameProject: (id: string, name: string) => void;
  onSetPermissionMode: (id: string, mode: PermissionMode) => void;
  onRevokeGrant: (id: string, grant: WorkspaceGrant) => void;
  onRemoveProject: (id: string) => void;
  onEditProjectMemory: (id: string) => void;
  onClearChats: () => void;
  onClearSessions: () => void;
  onLibraryChange?: () => void;
  /** Which page is open, for the shell: an update notice is noise on the Updates page. */
  onTabChange?: (tab: SettingsTab) => void;
  /** Downloads the first-run setup left unfinished, so they show among the rest. */
  startDownloads?: string[];
  /** Closes the settings view and returns to the active session. */
  onClose?: () => void;
}

/** Settings, in three groups: the app, Chat and Code. It stays mounted for the app's life, since a
 * model download lives here and must not stop when the user looks away. */
export default function SettingsPage(props: SettingsPageProps) {
  const { settings, request, onUpdate } = props;
  const t = useTranslator(settings.language);
  const [tab, setTab] = useState<SettingsTab>(request.tab);
  // Read again on every page, so a model pulled from the startup screen or the engine itself shows up.
  const manager = useModelManager(tab);

  const [seenRequest, setSeenRequest] = useState(request.id);
  const [query, setQuery] = useState("");
  const results = query.trim() ? searchSettings(query, t) : null;

  // A new request from outside, like "Manage models" in the composer, moves to its page.
  if (request.id !== seenRequest) {
    setSeenRequest(request.id);
    setTab(request.tab);
  }

  const { onLibraryChange, onTabChange, startDownloads, onClose } = props;
  const takenOver = useRef(new Set<string>());
  // A file already downloading is joined in the main process, not fetched a second time.
  useEffect(() => {
    for (const reference of startDownloads ?? []) {
      if (takenOver.current.has(reference)) continue;
      takenOver.current.add(reference);
      void manager.startPull(reference);
    }
  }, [startDownloads, manager]);
  const libraryChanged = useCallback(() => onLibraryChange?.(), [onLibraryChange]);

  useEffect(() => {
    onTabChange?.(tab);
  }, [tab, onTabChange]);
  useEffect(() => {
    logBreadcrumb("settings:page", { page: tab });
  }, [tab]);

  // Escape returns to the active session when no inner control consumes it.
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const navItem = (page: SettingsPageEntry, match?: string) => (
    <button
      key={page.id}
      type="button"
      onClick={() => setTab(page.id)}
      aria-current={tab === page.id ? "page" : undefined}
      className={`flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-start outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus ${
        tab === page.id ? "bg-surface-raised text-text-primary" : "text-text-secondary hover:bg-surface-raised hover:text-text-primary"
      }`}
    >
      <Icon name={page.icon} size={16} className="flex-shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] leading-5">{t(page.label)}</span>
        {match && <span className="block truncate text-[12px] leading-4 text-text-tertiary">{match}</span>}
      </span>
    </button>
  );

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-surface-canvas text-text-primary">
      <div className="flex min-h-0 flex-1">
        <nav aria-label={t("settings")} className="w-[232px] flex-shrink-0 overflow-y-auto border-e border-rule px-3 pb-6">
          <header className="flex items-center justify-between px-2 pb-3 pt-2">
            <h1 className="text-[15px] font-semibold leading-6">{t("settings")}</h1>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label={t("closeDialog")}
                title={t("closeDialog")}
                className="flex h-7 w-7 items-center justify-center rounded-sm text-text-secondary hover:bg-surface-raised hover:text-text-primary focus-visible:ring-2 focus-visible:ring-focus cursor-pointer"
              >
                <Icon name="x" size={16} />
              </button>
            )}
          </header>

          <label className="flex h-8 items-center gap-2 rounded-sm bg-surface-base px-2.5 shadow-[inset_0_0_0_1px_var(--rule-control)] focus-within:ring-2 focus-within:ring-focus">
            <Icon name="magnifying-glass" size={14} className="flex-shrink-0 text-text-tertiary" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && query) {
                  event.stopPropagation();
                  setQuery("");
                } else if (event.key === "Enter" && results?.[0]) {
                  setTab(results[0].page.id);
                }
              }}
              placeholder={t("settingsSearch")}
              aria-label={t("settingsSearch")}
              className="min-w-0 flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-tertiary [&::-webkit-search-cancel-button]:hidden"
            />
          </label>

          {results ? (
            <div className="pt-3">
              {results.length === 0 ? (
                <p className="px-2 py-1.5 text-[13px] leading-5 text-text-tertiary">{fill(t("settingsNoMatch"), { query: query.trim() })}</p>
              ) : (
                results.map(({ page, match }) => navItem(page, match))
              )}
            </div>
          ) : (
            SETTINGS_GROUPS.map((group) => (
              <div key={group.id} className="pt-4">
                <p className="px-2 pb-1 text-[12px] font-medium leading-4 text-text-tertiary">{t(group.label)}</p>
                {group.pages.map((page) => navItem(page))}
              </div>
            ))
          )}
        </nav>

        <main key={tab} className="flex-1 min-w-0 overflow-y-auto">
          <div className="mx-auto max-w-[720px] px-8 py-8">
            {tab === "general" && <GeneralPage settings={settings} onUpdate={onUpdate} t={t} />}

            {tab === "models" && (
              <ModelsPage
                manager={manager}
                settings={settings}
                chatModel={props.chatModel}
                onUpdate={onUpdate}
                t={t}
              />
            )}

            {tab === "providers" && <ProvidersPage engineModels={manager.installed.length} t={t} />}

            {tab === "web" && <WebSearchPage settings={settings} onUpdate={onUpdate} t={t} />}

            {tab === "usage" && (
              <Page title={t("statistics")}>
                <StatsPanel t={t} />
              </Page>
            )}

            {tab === "data" && (
              <DataPage
                t={t}
                onClearChats={props.onClearChats}
                onClearSessions={props.onClearSessions}
              />
            )}

            {tab === "diagnostics" && <DiagnosticsPage t={t} />}

            {tab === "api" && (
              <Page title={t("apiServer")}>
                <Group>
                  <Block>
                    <ApiServerField t={t} />
                  </Block>
                </Group>
              </Page>
            )}

            {tab === "updates" && <UpdatesPage settings={settings} onUpdate={onUpdate} t={t} />}

            {tab === "chat" && (
              <ChatPreferencesPage
                settings={settings}
                onUpdate={onUpdate}
                manager={manager}
                chatModel={props.chatModel}
                onSelectChatModel={props.onSelectChatModel}
                t={t}
              />
            )}

            {tab === "talk" && (
              <TalkPage settings={settings} onUpdate={onUpdate} manager={manager} t={t} />
            )}

            {tab === "library" && (
              <LibraryPage
                settings={settings}
                onUpdate={onUpdate}
                manager={manager}
                onLibraryChange={libraryChanged}
                t={t}
              />
            )}

            {tab === "extensions" && <ExtensionsPage t={t} />}

            {tab === "code" && (
              <CodePreferencesPage
                settings={settings}
                onUpdate={onUpdate}
                manager={manager}
                chatModel={props.chatModel}
                t={t}
              />
            )}

            {tab === "projects" && (
              <ProjectsPage
                projects={props.projects}
                initialProjectId={props.activeProjectId}
                onAddProject={props.onAddProject}
                onRename={props.onRenameProject}
                onSetPermissionMode={props.onSetPermissionMode}
                onRevokeGrant={props.onRevokeGrant}
                onRemove={props.onRemoveProject}
                onEditMemory={props.onEditProjectMemory}
                t={t}
              />
            )}

            {tab === "permissions" && (
              <PermissionsPage projects={props.projects} onRevokeGrant={props.onRevokeGrant} t={t} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
