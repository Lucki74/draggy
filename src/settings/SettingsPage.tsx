import { useCallback, useEffect, useState } from "react";
import { Block, Group, Page } from "./Controls";
import { SETTINGS_GROUPS } from "./pages";
import type { SettingsTab } from "./pages";
import { useModelManager } from "./useModelManager";
import ModelsPage from "./ModelsPage";
import { DataPage, ExtensionsPage, GeneralPage, UpdatesPage, WebSearchPage } from "./GeneralPages";
import { ChatPreferencesPage, LibraryPage, TalkPage } from "./ChatPages";
import { CodePreferencesPage, ProjectsPage } from "./CodePages";
import ApiServerField from "./ApiServerField";
import StatsPanel from "../stats/StatsPanel";
import { useTranslator } from "../i18n";
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

  // A new request from outside, like "Manage models" in the composer, moves to its page.
  if (request.id !== seenRequest) {
    setSeenRequest(request.id);
    setTab(request.tab);
  }

  const { onLibraryChange, onTabChange } = props;
  const libraryChanged = useCallback(() => onLibraryChange?.(), [onLibraryChange]);

  useEffect(() => {
    onTabChange?.(tab);
  }, [tab, onTabChange]);

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--bg-base)] overflow-hidden">
      <div className="pt-2 drag-region h-6 flex-shrink-0 w-full" />

      <div className="flex-1 flex min-h-0">
        <nav
          aria-label={t("settings")}
          className="w-56 flex-shrink-0 overflow-y-auto border-r-[3px] border-[var(--border-light)] px-3 pb-6"
        >
          <h1 className="px-3 pt-2 pb-3 text-lg font-bold uppercase tracking-wider text-[var(--text-main)]">
            {t("settings")}
          </h1>

          {SETTINGS_GROUPS.map((group) => (
            <div key={group.id} className="pt-3">
              <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                {t(group.label)}
              </p>
              {group.pages.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  aria-current={tab === id ? "page" : undefined}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                    tab === id
                      ? "bg-[var(--bg-inverted)] text-[var(--text-inverted)]"
                      : "text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)]"
                  }`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span className="text-sm font-bold truncate">{t(label)}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <main key={tab} className="flex-1 min-w-0 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-8 py-4">
            {tab === "general" && <GeneralPage settings={settings} onUpdate={onUpdate} t={t} />}

            {tab === "models" && (
              <ModelsPage
                manager={manager}
                settings={settings}
                chatModel={props.chatModel}
                onUpdate={onUpdate}
                onNavigate={setTab}
                t={t}
              />
            )}

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
          </div>
        </main>
      </div>
    </div>
  );
}
