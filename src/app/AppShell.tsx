import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  MessageSquare,
  Settings,
  AudioLines,
  FolderOpen,
  Folder,
  FolderPlus,
  Check,
  Loader2,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";
import ChatScreen from "../ChatScreen";
import SettingsPage from "../SettingsPage";
import type { SettingsTab } from "../SettingsPage";
import ChatHistory from "../ChatHistory";
import TalkScreen from "../TalkScreen";
import Explorer from "../files/Explorer";
import FileTree from "../files/FileTree";
import MemoryEditor from "../project/MemoryEditor";
import PlanPanel from "../plan/PlanPanel";
import type { PlanItem } from "../plan/plan";
import { loadProjectMemory } from "../project/load";
import { MEMORY_NAMES } from "../project/memory";
import { draftProjectMemory } from "../project/scan";
import { useTranslator } from "../i18n";
import { generateId } from "../utils";
import { chatToMarkdown, exportFilename } from "../chat/export";
import { unregisterGroup } from "../tools/registry";
import type { ToolEnvironment } from "../tools/registry";
import { syncMcpTools } from "../tools/mcp";
import type { McpServerState } from "../tools/mcp";
import { useSessions } from "./useSessions";
import { useAgentRuns } from "./useAgentRuns";
import { useUpdateDialog } from "./useUpdateDialog";
import { useWorkspaces } from "./useWorkspaces";
import {
  DEFAULT_WORKSPACE_ID,
  isDefault,
  resolveSettings,
  sessionsIn,
  workspaceLabel,
} from "../workspaces";
import type { AppSettings } from "../types";

export type ViewMode = "chat" | "history" | "files" | "talk" | "settings";

interface AppShellProps {
  model: string;
  settings: AppSettings;
  onUpdateSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  onSelectModel: (name: string) => void;
}

/**
 * The window around the screens: the sidebar, whichever surface is showing,
 * and the two things that can interrupt any of them (a finished update, and a
 * conversation that could not be saved).
 */
export default function AppShell({
  model,
  settings,
  onUpdateSettings,
  onSelectModel,
}: AppShellProps) {
  const t = useTranslator(settings.language);

  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [openedAt] = useState(() => Date.now());
  const [viewMode, setViewMode] = useState<ViewMode>("chat");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("appearance");
  const [libraryReady, setLibraryReady] = useState(false);
  const [treeOpen, setTreeOpen] = useState(true);
  /** How many skills this workspace can reach, which decides whether to offer any. */
  const [skillCount, setSkillCount] = useState(0);
  /** A background conversation that finished while the user was elsewhere. */
  const [finishedChatId, setFinishedChatId] = useState<string | null>(null);
  /** Which file the files screen opens on, when one was picked in the chat. */
  const [openedFile, setOpenedFile] = useState<string | null>(null);

  const store = useSessions();
  const update = useUpdateDialog();
  const workspaces = useWorkspaces();

  const active = workspaces.active;
  const effectiveSettings = resolveSettings(settings, active);

  const openSettings = useCallback((tab: SettingsTab) => {
    setSettingsTab(tab);
    setViewMode("settings");
  }, []);

  // MCP servers start after the window is up: `npx` may fetch a package, and
  // none of those tools are needed until the first message is sent.
  useEffect(() => {
    if (!window.electronAPI?.mcp) return;

    const api = window.electronAPI.mcp;
    const workspaceId = active.id;

    const call = (
      serverId: string,
      toolName: string,
      args: Record<string, unknown>,
    ) => api.call(serverId, toolName, args);

    // Which of the running servers this workspace asked for. A server another
    // workspace switched on keeps running; its tools simply are not offered
    // here.
    let allowed: string[] | null = null;

    const sync = (servers: McpServerState[]) =>
      syncMcpTools(
        allowed === null
          ? servers
          : servers.filter((server) => allowed?.includes(server.id)),
        call,
      );

    const stopWatching = api.onState((state) => sync(state.servers));

    api
      .enabled(workspaceId)
      .then((result) => {
        allowed = result?.ids ?? null;
        return api.startEnabled(workspaceId);
      })
      .then((result) => sync(result.servers ?? []))
      .catch(() => undefined);

    return () => {
      stopWatching();
      unregisterGroup("external");
    };
  }, [active.id]);

  const refreshLibraryReadiness = useCallback(() => {
    const library = window.electronAPI?.library;

    // No state write on this path: the environment below already ANDs with the
    // setting, and a synchronous write here would cascade out of the effect.
    if (!settings.libraryEnabled || !library) return;

    library
      .stats()
      .then((result) => setLibraryReady(Boolean(result?.stats && result.stats.chunks > 0)))
      .catch(() => setLibraryReady(false));
  }, [settings.libraryEnabled]);

  useEffect(refreshLibraryReadiness, [refreshLibraryReadiness, viewMode]);

  // Counted rather than listed here: the loop reads the skills themselves when
  // it builds a prompt, and the window only needs to know whether to offer the
  // tool at all.
  useEffect(() => {
    const api = window.electronAPI?.skills;
    if (!api) return;

    let cancelled = false;

    api
      .list(active.id)
      .then((result) => {
        if (!cancelled) setSkillCount(result?.skills?.length ?? 0);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [active.id, viewMode]);

  const environment: ToolEnvironment = {
    webMode: effectiveSettings.webMode,
    codeExecution:
      effectiveSettings.codeExecution && Boolean(window.electronAPI?.runner),
    libraryReady: libraryReady && effectiveSettings.libraryEnabled,
    hasFolder: Boolean(active.rootPath),
    projectRoot: active.rootPath ?? undefined,
    hasSkills: skillCount > 0,
  };

  const runs = useAgentRuns({
    model,
    settings: effectiveSettings,
    environment,
    workspaceId: active.id,
    permission: { mode: active.permissionMode, grants: active.grants },
    onGrant: workspaces.addGrant,
    onFinished: (chatId) => {
      // Only worth saying for a conversation the user is not looking at.
      if (chatId === selectedChatId) return;
      setFinishedChatId(chatId);
      setTimeout(() => setFinishedChatId((current) => (current === chatId ? null : current)), 8000);
    },
    t,
    getSession: store.getSession,
    addSession: store.addSession,
    updateSession: store.updateSession,
    patchActiveMessage: store.patchActiveMessage,
  });

  /**
   * Writes the conversation into the app's own files folder, the same place
   * the model puts what it makes, and shows it.
   */
  const handleExportChat = useCallback(
    async (event: React.MouseEvent, chatId: string) => {
      event.stopPropagation();

      const chat = store.getSession(chatId);
      if (!chat || !window.electronAPI) return;

      const markdown = chatToMarkdown(chat, { assistantName: model || "Assistant" });
      const result = await window.electronAPI.createFile(
        exportFilename(chat),
        markdown,
      );

      if (result?.success && result.filepath) {
        window.electronAPI.revealCreatedFile(result.filepath);
      } else {
        store.setStorageWarning(result?.error || t("chatExportFailed"));
      }
    },
    [model, t, store],
  );

  const handleDeleteChat = useCallback(
    (e: React.MouseEvent, chatId: string) => {
      e.stopPropagation();
      runs.stop(chatId);
      store.deleteSession(chatId);
      // Back to no choice, which reads as the most recent conversation left.
      setSelectedChatId((current) => (current === chatId ? null : current));
    },
    [runs, store],
  );

  /**
   * The project's instruction file, opened from `/memory`, or drafted from what
   * is in the folder by `/init`. Nothing is written until the user saves.
   */
  const [memoryDraft, setMemoryDraft] = useState<{
    path: string;
    text: string;
  } | null>(null);

  const openProjectMemory = useCallback(async () => {
    if (!active.rootPath) return;

    const existing = await loadProjectMemory(active.id, active.rootPath);
    setMemoryDraft({
      path: existing?.path ?? MEMORY_NAMES[0],
      text: existing?.text ?? "",
    });
  }, [active]);

  const draftProject = useCallback(async () => {
    if (!active.rootPath) return;

    const existing = await loadProjectMemory(active.id, active.rootPath);
    const drafted = await draftProjectMemory(
      active.id,
      active.rootPath,
      workspaceLabel(active, t),
    );

    // A project that already says something keeps it: the draft goes under it
    // rather than over it.
    setMemoryDraft({
      path: existing?.path ?? MEMORY_NAMES[0],
      text: existing?.text ? `${existing.text}\n\n${drafted}` : drafted,
    });
  }, [active, t]);

  const saveProjectMemory = useCallback(
    async (text: string) => {
      if (!memoryDraft) return false;

      const result = await window.electronAPI?.files?.write(
        active.id,
        memoryDraft.path,
        text,
      );

      if (result?.success) return true;

      store.setStorageWarning(result?.error || t("undoFailed"));
      return false;
    },
    [active.id, memoryDraft, store, t],
  );

  /** Puts a file back the way it was, from the step that changed it. */
  const handleRevert = useCallback(
    async (checkpointId: number) => {
      const result = await window.electronAPI?.files?.revert(checkpointId);
      if (result?.success) return true;

      store.setStorageWarning(result?.error || t("undoFailed"));
      return false;
    },
    [store, t],
  );

  const handleNewChat = useCallback(() => {
    setSelectedChatId(generateId());
    setViewMode("chat");
  }, []);

  const selectChat = useCallback((id: string) => {
    setSelectedChatId(id);
    setViewMode("chat");
  }, []);

  const handleClearChats = useCallback(() => {
    runs.stopAll();
    store.clearSessions();
    setSelectedChatId(null);
  }, [runs, store]);

  const handleSelectWorkspace = useCallback(
    (id: string) => {
      workspaces.select(id);
      // Its own most recent conversation, rather than one from somewhere else.
      setSelectedChatId(null);
      setViewMode("chat");
    },
    [workspaces],
  );

  const handleNewProject = useCallback(async () => {
    const created = await workspaces.addProject();
    if (!created) return;

    setSelectedChatId(null);
    setViewMode("chat");
  }, [workspaces]);

  const handleRemoveWorkspace = useCallback(
    async (event: React.MouseEvent, id: string) => {
      event.stopPropagation();

      const { moved } = await workspaces.remove(id);
      // The database has already moved them; the window has not heard yet.
      if (moved > 0) store.reassign(id, DEFAULT_WORKSPACE_ID);
      setSelectedChatId(null);
    },
    [workspaces, store],
  );

  /** Only this workspace's conversations, everywhere the app lists them. */
  const visibleSessions = useMemo(
    () => sessionsIn(store.sessions, active.id),
    [store.sessions, active.id],
  );

  /**
   * The id an untouched first conversation gets, one per workspace: two of them
   * sharing an id would have the second write into the first one's messages.
   */
  const blankChatId = `blank-${active.id}`;

  /**
   * What the chat screen is showing: the user's choice, or the conversation
   * they left off in, or an empty one. Derived rather than restored in an
   * effect, which would paint once with nothing before correcting itself.
   */
  const currentChatId = store.hydrated
    ? (selectedChatId ?? visibleSessions[0]?.id ?? blankChatId)
    : selectedChatId;

  // Stable identities so MessageItem's memo() actually skips unchanged
  // messages; an inline arrow would hand each a new prop on every render. The
  // manager's own handlers never change, so only the conversation id does.
  const { regenerate, switchVersion, editMessage } = runs;
  const chatId = currentChatId ?? "";

  const onRegenerateChat = useCallback(
    (idx: number) => {
      if (chatId) regenerate(chatId, idx);
    },
    [chatId, regenerate],
  );
  const onSwitchVersionChat = useCallback(
    (mIdx: number, vIdx: number) => {
      if (chatId) switchVersion(chatId, mIdx, vIdx);
    },
    [chatId, switchVersion],
  );
  const onEditMessageChat = useCallback(
    (mIdx: number, content: string) => {
      if (chatId) editMessage(chatId, mIdx, content);
    },
    [chatId, editMessage],
  );

  const currentSession = visibleSessions.find((s) => s.id === currentChatId);

  return (
    <div
      className="w-screen h-screen overflow-hidden flex transition-colors duration-300"
      style={{ backgroundColor: "var(--bg-base)", color: "var(--text-main)" }}
    >
      {update.ready !== null && !update.dismissed && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="update-ready-title"
        >
          <div className="mx-4 w-full max-w-sm rounded-2xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)] p-6 shadow-xl">
            <h2
              id="update-ready-title"
              className="text-base font-bold tracking-wide"
            >
              {t("updateReadyTitle")}
            </h2>

            <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
              {update.ready
                ? `${t("updateReadyBody")} (${update.ready})`
                : t("updateReadyBody")}
            </p>

            <div className="mt-5 flex gap-2">
              <button
                onClick={() => window.electronAPI?.updater.install()}
                className="flex-1 rounded-xl bg-[var(--bg-inverted)] px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-[var(--text-inverted)] transition-opacity hover:opacity-90"
              >
                {t("updateInstallNow")}
              </button>

              <button
                onClick={update.dismiss}
                className="flex-1 rounded-xl border-[3px] border-[var(--border-light)] px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] transition-colors hover:text-[var(--text-main)]"
              >
                {t("updateLater")}
              </button>
            </div>
          </div>
        </div>
      )}

      {memoryDraft && (
        <MemoryEditor
          path={memoryDraft.path}
          initial={memoryDraft.text}
          t={t}
          onSave={saveProjectMemory}
          onClose={() => setMemoryDraft(null)}
        />
      )}

      {finishedChatId && (
        <button
          onClick={() => {
            selectChat(finishedChatId);
            setFinishedChatId(null);
          }}
          className="fixed bottom-4 right-4 z-[100] flex items-center gap-3 rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)] px-4 py-3 shadow-lg"
        >
          <Check className="h-4 w-4 text-[var(--text-muted)]" />
          <span className="text-xs font-bold tracking-tight">
            {t("taskFinished")}
            <span className="ml-2 font-normal text-[var(--text-muted)]">
              {store.sessions.find((one) => one.id === finishedChatId)?.title}
            </span>
          </span>
        </button>
      )}

      {store.storageWarning && (
        <div
          role="alert"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 px-4 py-3 rounded-xl border-[3px] border-red-500 bg-[var(--bg-panel)] shadow-lg"
        >
          <span className="text-xs font-bold text-red-500">{store.storageWarning}</span>
          <button
            onClick={() => store.setStorageWarning(null)}
            className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-main)]"
          >
            {t("dismiss")}
          </button>
        </div>
      )}

      <div
        className="group w-[68px] hover:w-[260px] transition-all duration-300 relative z-50 h-full flex flex-col flex-shrink-0 overflow-hidden border-r-[3px]"
        style={{
          backgroundColor: "var(--bg-panel)",
          borderColor: "var(--border-light)",
        }}
      >
        <div className="w-[260px] h-full flex flex-col flex-shrink-0 relative">
          <div className="pt-2 drag-region h-6 flex-shrink-0 w-full" />

          <div className="flex flex-col gap-3 px-[14px] py-3 mt-0 no-drag">
            <button onClick={handleNewChat} className="flex items-center w-full p-2 rounded-lg hover:bg-[var(--hover-bg)] transition-colors group/btn overflow-hidden">
              <Plus className="w-6 h-6 flex-shrink-0 text-[var(--text-main)]" />
              <span className="ml-4 font-bold tracking-wider text-sm whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                {t("newDiscussion")}
              </span>
            </button>

            <button onClick={() => setViewMode("history")} className="flex items-center w-full p-2 rounded-lg hover:bg-[var(--hover-bg)] transition-colors group/btn overflow-hidden">
              <MessageSquare className="w-6 h-6 flex-shrink-0 text-[var(--text-main)]" />
              <span className="ml-4 font-bold tracking-wider text-sm whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                {t("chatHistory")}
              </span>
            </button>

            <button onClick={() => setViewMode("files")} className="flex items-center w-full p-2 rounded-lg hover:bg-[var(--hover-bg)] transition-colors group/btn overflow-hidden">
              <FolderOpen className="w-6 h-6 flex-shrink-0 text-[var(--text-main)]" />
              <span className="ml-4 font-bold tracking-wider text-sm whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                {t("createdFiles")}
              </span>
            </button>

            <button onClick={() => setViewMode("talk")} className="flex items-center w-full p-2 rounded-lg hover:bg-[var(--hover-bg)] transition-colors group/btn overflow-hidden">
              <AudioLines className="w-6 h-6 flex-shrink-0 text-[var(--text-main)]" />
              <span className="ml-4 font-bold tracking-wider text-sm whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                {t("talk")}
              </span>
              <span className="ml-2 px-1.5 py-0.5 rounded border border-[var(--border-light)] text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                {t("beta")}
              </span>
            </button>

            <button onClick={() => openSettings("appearance")} className="flex items-center w-full p-2 rounded-lg hover:bg-[var(--hover-bg)] transition-colors group/btn overflow-hidden">
              <Settings className="w-6 h-6 flex-shrink-0 text-[var(--text-main)]" />
              <span className="ml-4 font-bold tracking-wider text-sm whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                {t("settings")}
              </span>
            </button>
          </div>

          <div
            className="mt-2 flex flex-col gap-1 px-[14px] py-3 no-drag border-t-[3px] overflow-y-auto"
            style={{ borderColor: "var(--border-light)" }}
          >
            <span className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
              {t("workspaces")}
            </span>

            {workspaces.workspaces.map((one) => (
              <div
                key={one.id}
                className={
                  one.id === active.id
                    ? "flex items-center w-full rounded-lg bg-[var(--hover-bg)]"
                    : "flex items-center w-full rounded-lg hover:bg-[var(--hover-bg)] transition-colors"
                }
              >
                <button
                  onClick={() => handleSelectWorkspace(one.id)}
                  title={one.rootPath || undefined}
                  aria-current={one.id === active.id}
                  className="flex items-center flex-1 min-w-0 p-2 overflow-hidden"
                >
                  {isDefault(one) ? (
                    <MessagesSquare className="w-6 h-6 flex-shrink-0 text-[var(--text-main)]" />
                  ) : (
                    <Folder className="w-6 h-6 flex-shrink-0 text-[var(--text-main)]" />
                  )}
                  <span className="ml-4 font-bold tracking-wider text-sm truncate opacity-0 group-hover:opacity-100 transition-opacity">
                    {workspaceLabel(one, t)}
                  </span>
                </button>

                {!isDefault(one) && (
                  <button
                    onClick={(event) => handleRemoveWorkspace(event, one.id)}
                    aria-label={t("removeProject")}
                    title={t("removeProject")}
                    className="mr-2 p-1 rounded opacity-0 group-hover:opacity-60 hover:opacity-100 transition-opacity"
                  >
                    <X className="w-4 h-4 text-[var(--text-muted)]" />
                  </button>
                )}
              </div>
            ))}

            {runs.running.length > 0 && (
              <div
                className="mt-2 flex flex-col gap-1 border-t-[3px] pt-2"
                style={{ borderColor: "var(--border-light)" }}
              >
                <span className="px-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                  {t("working")}
                </span>

                {runs.running.map((id) => {
                  const session = store.sessions.find((one) => one.id === id);

                  return (
                    <button
                      key={id}
                      onClick={() => selectChat(id)}
                      title={session?.title || t("newDiscussion")}
                      className="flex items-center w-full p-2 rounded-lg hover:bg-[var(--hover-bg)] transition-colors overflow-hidden"
                    >
                      <Loader2 className="w-5 h-5 flex-shrink-0 animate-spin text-[var(--text-muted)]" />
                      <span className="ml-4 text-xs font-bold truncate opacity-0 group-hover:opacity-100 transition-opacity">
                        {session?.title || t("newDiscussion")}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <button
              onClick={handleNewProject}
              className="flex items-center w-full p-2 rounded-lg hover:bg-[var(--hover-bg)] transition-colors overflow-hidden"
            >
              <FolderPlus className="w-6 h-6 flex-shrink-0 text-[var(--text-muted)]" />
              <span className="ml-4 font-bold tracking-wider text-sm whitespace-nowrap text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity">
                {t("newProject")}
              </span>
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0 relative">
        {viewMode === "history" ? (
          <ChatHistory
            sessions={visibleSessions}
            onSelectChat={selectChat}
            onDeleteChat={handleDeleteChat}
            onExportChat={handleExportChat}
            settings={settings}
          />
        ) : viewMode === "files" ? (
          <Explorer
            settings={settings}
            workspace={active}
            initialPath={openedFile}
          />
        ) : viewMode === "talk" ? (
          <TalkScreen settings={settings} />
        ) : currentChatId ? (
          <div className="flex-1 flex min-h-0">
            {active.rootPath &&
              (treeOpen ? (
                <div
                  className="w-56 flex-shrink-0 flex flex-col overflow-hidden border-r-[3px]"
                  style={{ borderColor: "var(--border-light)" }}
                >
                  <div
                    className="flex items-center gap-1 px-2 py-2 border-b-[3px]"
                    style={{ borderColor: "var(--border-light)" }}
                  >
                    <button
                      onClick={() => void openProjectMemory()}
                      title={t("projectMemory")}
                      className="flex-1 min-w-0 truncate rounded-lg px-2 py-1 text-left text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)]"
                    >
                      {t("projectMemory")}
                    </button>

                    <button
                      onClick={() => setTreeOpen(false)}
                      aria-label={t("hideFiles")}
                      title={t("hideFiles")}
                      className="p-1 rounded-lg text-[var(--text-muted)] hover:bg-[var(--hover-bg)]"
                    >
                      <PanelLeftClose className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto">
                    <FileTree
                      workspaceId={active.id}
                      root={active.rootPath}
                      selected={null}
                      onSelect={(entry) => {
                        setOpenedFile(entry.path);
                        setViewMode("files");
                      }}
                      t={t}
                    />
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setTreeOpen(true)}
                  aria-label={t("showFiles")}
                  title={t("showFiles")}
                  className="w-8 flex-shrink-0 flex items-start justify-center pt-3 border-r-[3px] text-[var(--text-muted)] hover:text-[var(--text-main)]"
                  style={{ borderColor: "var(--border-light)" }}
                >
                  <PanelLeftOpen className="w-4 h-4" />
                </button>
              ))}

            <ChatScreen
            model={model}
            chat={
              currentSession || {
                id: currentChatId,
                title: "New Chat",
                messages: [],
                updatedAt: openedAt,
                isGenerating: false,
              }
            }
            onSendMessage={(content, attachments) =>
              runs.send(currentChatId, content, attachments)
            }
            onRegenerate={onRegenerateChat}
            onSwitchVersion={onSwitchVersionChat}
            onEditMessage={onEditMessageChat}
            onStopGeneration={() => runs.stop(currentChatId)}
            onContinueGeneration={() => runs.continueGeneration(currentChatId)}
            onDismissOutOfContext={() => runs.dismissOutOfContext(currentChatId)}
            onApproval={runs.answerApproval}
            onRevert={handleRevert}
            onProjectMemory={active.rootPath ? openProjectMemory : undefined}
            onInitProject={active.rootPath ? draftProject : undefined}
            onSelectModel={onSelectModel}
            onOpenSettings={openSettings}
            onNewChat={handleNewChat}
            settings={settings}
            onUpdateSettings={onUpdateSettings}
            />

            {currentSession?.plan && currentSession.plan.length > 0 && (
              <div
                className="w-64 flex-shrink-0 border-l-[3px]"
                style={{ borderColor: "var(--border-light)" }}
              >
                <PlanPanel
                  items={currentSession.plan}
                  running={runs.running.includes(currentChatId)}
                  onChange={(items: PlanItem[]) =>
                    store.updateSession(currentChatId, (session) => ({
                      ...session,
                      plan: items,
                    }))
                  }
                  onContinue={() => runs.send(currentChatId, t("continuePlan"))}
                  t={t}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-[var(--bg-base)]" />
        )}

        {/*
          Mounted for the life of the app rather than only while it is open. A
          model download lives in this component, and unmounting it aborted the
          pull the moment the user looked at anything else.
        */}
        <div
          className={
            viewMode === "settings"
              ? // Opaque, or the chat's composer shows through underneath it.
                "absolute inset-0 z-20 flex flex-col bg-[var(--bg-base)]"
              : "absolute inset-0 z-20 flex flex-col bg-[var(--bg-base)] invisible pointer-events-none"
          }
          aria-hidden={viewMode !== "settings"}
        >
          <SettingsPage
            settings={settings}
            activeModel={model}
            initialTab={settingsTab}
            onUpdate={onUpdateSettings}
            onSelectModel={onSelectModel}
            onClearChats={handleClearChats}
            onLibraryChange={refreshLibraryReadiness}
            workspaceId={active.id}
          />
        </div>
      </div>
    </div>
  );
}
