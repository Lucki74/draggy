import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";
import ChatScreen from "../ChatScreen";
import Canvas from "../canvas/Canvas";
import GitStrip from "../project/GitStrip";
import { useApiBridge } from "../api/useApiBridge";
import { useGitStatus } from "../project/useGitStatus";
import { shouldShowStrip } from "../project/gitView";
import SettingsPage from "../settings/SettingsPage";
import type { SettingsRequest } from "../settings/SettingsPage";
import type { SettingsTab } from "../settings/pages";
import { ConfirmDialog } from "../settings/Controls";
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
import { isCloudModel, warmModel } from "../ollama";
import { KEEP_ALIVE } from "../agent/agentLoop";
import { chatToMarkdown, exportFilename } from "../chat/export";
import { unregisterGroup } from "../tools/registry";
import type { ToolEnvironment } from "../tools/registry";
import { syncMcpTools } from "../tools/mcp";
import type { McpServerState } from "../tools/mcp";
import { useSessions } from "./useSessions";
import { useAgentRuns } from "./useAgentRuns";
import { useUpdateDialog } from "./useUpdateDialog";
import { ACTIVE_WORKSPACE_KEY, useWorkspaces } from "./useWorkspaces";
import ModeSwitch from "./ModeSwitch";
import CodeHome from "./CodeHome";
import {
  LAST_PROJECT_KEY,
  MODE_KEY,
  initialMode,
  isProject,
  modeOf,
  patchForMode,
  projectsOf,
  runningInMode,
  settingsForMode,
  workspaceForMode,
  workspaceOfChat,
} from "./modes";
import type { AppMode } from "./modes";
import {
  fallbackWorkspace,
  isDefault,
  resolveSettings,
  sessionsIn,
  workspaceIdOf,
  workspaceLabel,
} from "../workspaces";
import { writeLocalStorage } from "../utils";
import type { AppSettings, ChatSession, Workspace } from "../types";

export type ViewMode = "chat" | "history" | "files" | "talk" | "settings";

interface AppShellProps {
  model: string;
  settings: AppSettings;
  onUpdateSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  onSelectModel: (name: string) => void;
}

/** The window around the screens: the sidebar, the current surface, and the two interruptions any
 * of them can get (an update, a failed save). */
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
  const [settingsRequest, setSettingsRequest] = useState<SettingsRequest>({
    tab: "general",
    id: 0,
  });
  /** A project the user asked to remove, waiting on their confirmation. */
  const [removingProjectId, setRemovingProjectId] = useState<string | null>(null);
  const [libraryReady, setLibraryReady] = useState(false);
  const [treeOpen, setTreeOpen] = useState(true);
  /** How many skills this workspace can reach, which decides whether to offer any. */
  const [skillCount, setSkillCount] = useState(0);
  /** A background conversation that finished while the user was elsewhere. */
  const [finishedChatId, setFinishedChatId] = useState<string | null>(null);
  // The chat on screen, if any. A new chat is never "selected", so the selection alone is not it.
  const watchingRef = useRef<string | null>(null);
  /** The file open in the canvas, with the workspace it belongs to. Switching workspace hides it
   * rather than trying to open one project's file in another. */
  const [canvas, setCanvas] = useState<{ workspaceId: string; path: string } | null>(null);

  const pinSidebar = useCallback((node: HTMLDivElement | null) => {
    const rail = node?.parentElement;
    if (!rail) return;
    rail.addEventListener("scroll", () => {
      if (rail.scrollLeft !== 0) rail.scrollLeft = 0;
    });
  }, []);

  const store = useSessions();
  const update = useUpdateDialog();
  const workspaces = useWorkspaces();

  const [mode, setMode] = useState<AppMode>(() =>
    initialMode(localStorage.getItem(MODE_KEY), localStorage.getItem(ACTIVE_WORKSPACE_KEY)),
  );
  const projects = projectsOf(workspaces.workspaces);
  const defaultWorkspace =
    workspaces.workspaces.find((one) => isDefault(one)) ?? fallbackWorkspace();

  // The mode decides which side a workspace is shown on: a project never appears in Chat, and
  // Code with no project open shows its own home rather than a plain chat.
  const codeHome = mode === "code" && !isProject(workspaces.active);
  const active =
    mode === "code"
      ? codeHome
        ? defaultWorkspace
        : workspaces.active
      : isProject(workspaces.active)
        ? defaultWorkspace
        : workspaces.active;

  const canvasPath = canvas && canvas.workspaceId === active.id ? canvas.path : null;
  const gitStatus = useGitStatus(active.id, active.rootPath ?? null);
  const closeCanvas = useCallback(() => setCanvas(null), []);
  const followCanvas = useCallback(
    (path: string) =>
      setCanvas((previous) => (previous ? { ...previous, path } : previous)),
    [],
  );
  // Each side runs with its own settings: Code reads its own model, instructions, thinking and web.
  const effectiveSettings = resolveSettings(settingsForMode(settings, mode), active);
  const turnModel = mode === "code" ? effectiveSettings.modelName || model : model;

  const openSettings = useCallback((tab: SettingsTab) => {
    setSettingsRequest((current) => ({ tab, id: current.id + 1 }));
    setViewMode("settings");
  }, []);

  /** A change to settings, merged into the latest ones rather than a copy from an older render. */
  const updateSettings = useCallback(
    (patch: Partial<AppSettings>) => onUpdateSettings((current) => ({ ...current, ...patch })),
    [onUpdateSettings],
  );

  /** A change from the composer, written to the fields of the side it was made on. */
  const patchFromComposer = useCallback(
    (patch: Partial<AppSettings>) => updateSettings(patchForMode(mode, patch)),
    [mode, updateSettings],
  );

  const selectModelHere = useCallback(
    (name: string) => {
      if (mode === "chat") {
        onSelectModel(name);
        return;
      }

      updateSettings({ codeModel: name });
      if (!isCloudModel(name)) warmModel(name, KEEP_ALIVE).catch(() => undefined);
    },
    [mode, onSelectModel, updateSettings],
  );

  // MCP servers start after the window is up: `npx` may fetch a package, and
  // none of those tools are needed until the first message is sent.
  useEffect(() => {
    if (!window.electronAPI?.mcp) return;

    const api = window.electronAPI.mcp;

    const call = (
      serverId: string,
      toolName: string,
      args: Record<string, unknown>,
    ) => api.call(serverId, toolName, args);

    // The servers switched on. Extensions are global, so Chat and every project share them.
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
      .enabled()
      .then((result) => {
        allowed = result?.ids ?? null;
        return api.startEnabled();
      })
      .then((result) => sync(result.servers ?? []))
      .catch(() => undefined);

    return () => {
      stopWatching();
      unregisterGroup("external");
    };
  }, []);

  // Whether Chat's library has anything indexed. Code has no library: the project is what it searches.
  const refreshLibraryReadiness = useCallback(() => {
    const library = window.electronAPI?.library;
    if (!library) return;

    library
      .list(defaultWorkspace.id)
      .then((result) =>
        setLibraryReady(Boolean(result?.sources?.some((source) => source.chunks > 0))),
      )
      .catch(() => setLibraryReady(false));
  }, [defaultWorkspace.id]);

  useEffect(refreshLibraryReadiness, [refreshLibraryReadiness, viewMode]);

  // Counted rather than listed here: the loop reads the skills themselves when it builds a prompt,
  // and the window only needs to know whether to offer the tool at all.
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
    // Running code and commands belong to Code, always on there and governed by the project's
    // permission mode. Chat has neither.
    codeExecution: mode === "code" && Boolean(window.electronAPI?.runner),
    canRunCommands: mode === "code" && Boolean(window.electronAPI?.commands),
    libraryReady: mode === "chat" && libraryReady && effectiveSettings.libraryEnabled,
    hasFolder: Boolean(active.rootPath),
    projectRoot: active.rootPath ?? undefined,
    hasSkills: skillCount > 0,
    hasGit: Boolean(active.rootPath && gitStatus?.available && gitStatus.isRepo),
  };

  // Requests to the local API, when the user has turned it on, are answered
  // by this window with the model and settings it has right now.
  useApiBridge({ model, settings: settingsForMode(settings, "chat"), t });

  const runs = useAgentRuns({
    model: turnModel,
    settings: effectiveSettings,
    environment,
    workspaceId: active.id,
    permission: { mode: active.permissionMode, grants: active.grants },
    onGrant: workspaces.addGrant,
    onFinished: (chatId) => {
      // Only worth saying for a conversation the user is not looking at.
      if (chatId === watchingRef.current) return;
      setFinishedChatId(chatId);
      setTimeout(() => setFinishedChatId((current) => (current === chatId ? null : current)), 8000);
    },
    t,
    getSession: store.getSession,
    addSession: store.addSession,
    updateSession: store.updateSession,
    patchActiveMessage: store.patchActiveMessage,
  });

  /** Writes the conversation into the app's own files folder, the same place the model puts what it
   * makes, and shows it. */
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

  /** The project's instruction file, opened from `/memory`, or drafted from what is in the folder
   * by `/init`. Nothing is written until the user saves. */
  const [memoryDraft, setMemoryDraft] = useState<{
    workspaceId: string;
    path: string;
    text: string;
  } | null>(null);

  const openMemoryOf = useCallback(async (workspace: Workspace | undefined) => {
    if (!workspace?.rootPath) return;

    const existing = await loadProjectMemory(workspace.id, workspace.rootPath);
    setMemoryDraft({
      workspaceId: workspace.id,
      path: existing?.path ?? MEMORY_NAMES[0],
      text: existing?.text ?? "",
    });
  }, []);

  const openProjectMemory = useCallback(() => openMemoryOf(active), [openMemoryOf, active]);

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
      workspaceId: active.id,
      path: existing?.path ?? MEMORY_NAMES[0],
      text: existing?.text ? `${existing.text}\n\n${drafted}` : drafted,
    });
  }, [active, t]);

  const saveProjectMemory = useCallback(
    async (text: string) => {
      if (!memoryDraft) return false;

      const result = await window.electronAPI?.files?.write(
        memoryDraft.workspaceId,
        memoryDraft.path,
        text,
      );

      if (result?.success) return true;

      store.setStorageWarning(result?.error || t("undoFailed"));
      return false;
    },
    [memoryDraft, store, t],
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

  /** Clears one side's conversations and leaves the other's alone. */
  const clearSide = useCallback(
    (side: AppMode) => {
      const inSide = (session: ChatSession) =>
        (workspaceIdOf(session) === defaultWorkspace.id) === (side === "chat");

      for (const session of store.sessions) {
        if (inSide(session)) runs.stop(session.id);
      }
      store.deleteSessionsWhere(inSide);
      setSelectedChatId(null);
    },
    [runs, store, defaultWorkspace.id],
  );

  const enterMode = useCallback((next: AppMode) => {
    setMode(next);
    writeLocalStorage(MODE_KEY, next);
  }, []);

  const handleSelectWorkspace = useCallback(
    (id: string) => {
      workspaces.select(id);
      const workspace = workspaces.workspaces.find((one) => one.id === id);
      if (isProject(workspace)) writeLocalStorage(LAST_PROJECT_KEY, id);
      enterMode(modeOf(workspace));
      // Its own most recent conversation, rather than one from somewhere else.
      setSelectedChatId(null);
      setViewMode("chat");
    },
    [workspaces, enterMode],
  );

  const handleSwitchMode = useCallback(
    (next: AppMode) => {
      enterMode(next);
      const target = workspaceForMode(
        next,
        workspaces.workspaces,
        localStorage.getItem(LAST_PROJECT_KEY),
      );
      if (target) workspaces.select(target);
      setSelectedChatId(null);
      setViewMode("chat");
    },
    [workspaces, enterMode],
  );

  const addProject = useCallback(async () => {
    const created = await workspaces.addProject(settings.codePermissionMode);
    if (created) writeLocalStorage(LAST_PROJECT_KEY, created.id);
    return created;
  }, [workspaces, settings.codePermissionMode]);

  const handleNewProject = useCallback(async () => {
    const created = await addProject();
    if (!created) return;

    enterMode("code");
    setSelectedChatId(null);
    setViewMode("chat");
  }, [addProject, enterMode]);

  /** Opens a conversation wherever it lives, switching workspace and mode first. Opening it from
   * the wrong workspace showed an empty chat under its id. */
  const openChat = useCallback(
    (id: string) => {
      const workspaceId = workspaceOfChat(store.sessions, id);
      const workspace = workspaces.workspaces.find((one) => one.id === workspaceId);

      if (workspace && workspace.id !== workspaces.active.id) {
        workspaces.select(workspace.id);
        if (isProject(workspace)) writeLocalStorage(LAST_PROJECT_KEY, workspace.id);
      }
      if (workspace) enterMode(modeOf(workspace));

      setSelectedChatId(id);
      setViewMode("chat");
    },
    [store.sessions, workspaces, enterMode],
  );

  /** Removes a project once the user has confirmed, with its sessions. The folder stays. */
  const removeProject = useCallback(
    async (id: string) => {
      for (const session of sessionsIn(store.sessions, id)) runs.stop(session.id);

      const { removed } = await workspaces.remove(id);
      // The database has already deleted them; the window has not heard yet.
      if (removed) store.forgetWorkspace(id);
      setSelectedChatId(null);
    },
    [workspaces, store, runs],
  );

  const handleRemoveWorkspace = useCallback((event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    setRemovingProjectId(id);
  }, []);

  /** Only this workspace's conversations, everywhere the app lists them. */
  const visibleSessions = useMemo(
    () => sessionsIn(store.sessions, active.id),
    [store.sessions, active.id],
  );

  /** The id an untouched first conversation gets, one per workspace: two of them sharing an id
   * would have the second write into the first one's messages. */
  const blankChatId = `blank-${active.id}`;

  /** What the chat screen shows: the user's choice, the conversation they left, or a new one.
   * Derived, since an effect would paint empty first. */
  const currentChatId = store.hydrated
    ? (selectedChatId ?? visibleSessions[0]?.id ?? blankChatId)
    : selectedChatId;

  useEffect(() => {
    watchingRef.current = viewMode === "chat" ? currentChatId : null;
  });

  // Stable identities so MessageItem's memo() skips unchanged messages; an inline arrow would be a
  // new prop every render.
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
  const runningHere = runningInMode(runs.running, store.sessions, workspaces.workspaces, mode);
  const hasPlan = Boolean(currentSession?.plan && currentSession.plan.length > 0);

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

      {removingProjectId && (
        <ConfirmDialog
          title={t("removeProject")}
          body={t("confirmRemoveProject").replace(
            "{name}",
            workspaceLabel(
              workspaces.workspaces.find((one) => one.id === removingProjectId),
              t,
            ),
          )}
          confirmLabel={t("removeProject")}
          cancelLabel={t("cancel")}
          onCancel={() => setRemovingProjectId(null)}
          onConfirm={() => {
            const id = removingProjectId;
            setRemovingProjectId(null);
            void removeProject(id);
          }}
        />
      )}

      {finishedChatId && (
        <button
          onClick={() => {
            openChat(finishedChatId);
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
        {/* Focus or a script can scroll a clipped box sideways, which shifted the rail's contents
            out of view; it is pinned back at once. */}
        <div
          className="w-[260px] h-full flex flex-col flex-shrink-0 relative"
          ref={pinSidebar}
        >
          <div className="pt-2 drag-region h-6 flex-shrink-0 w-full" />

          {/* Chat and Code are separate places; the switch sits first, above everything they differ in. */}
          <div className="px-[6px] group-hover:px-[14px] pt-1 no-drag transition-all">
            <div className="w-[56px] group-hover:w-[232px] transition-all">
              <ModeSwitch mode={mode} onChange={handleSwitchMode} t={t} />
            </div>
          </div>

          <div className="flex flex-col gap-3 px-[14px] py-3 mt-0 no-drag">
            <button onClick={codeHome ? handleNewProject : handleNewChat} className="flex items-center w-full p-2 rounded-lg hover:bg-[var(--hover-bg)] transition-colors group/btn overflow-hidden">
              <Plus className="w-6 h-6 flex-shrink-0 text-[var(--text-main)]" />
              <span className="ml-4 font-bold tracking-wider text-sm whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                {mode === "code" ? t("newSession") : t("newDiscussion")}
              </span>
            </button>

            <button onClick={() => setViewMode("history")} className="flex items-center w-full p-2 rounded-lg hover:bg-[var(--hover-bg)] transition-colors group/btn overflow-hidden">
              <MessageSquare className="w-6 h-6 flex-shrink-0 text-[var(--text-main)]" />
              <span className="ml-4 font-bold tracking-wider text-sm whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                {mode === "code" ? t("sessions") : t("chatHistory")}
              </span>
            </button>

            <button onClick={() => setViewMode("files")} className="flex items-center w-full p-2 rounded-lg hover:bg-[var(--hover-bg)] transition-colors group/btn overflow-hidden">
              <FolderOpen className="w-6 h-6 flex-shrink-0 text-[var(--text-main)]" />
              <span className="ml-4 font-bold tracking-wider text-sm whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                {mode === "code" ? t("projectFiles") : t("createdFiles")}
              </span>
            </button>

            {mode === "chat" && (
              <button onClick={() => setViewMode("talk")} className="flex items-center w-full p-2 rounded-lg hover:bg-[var(--hover-bg)] transition-colors group/btn overflow-hidden">
                <AudioLines className="w-6 h-6 flex-shrink-0 text-[var(--text-main)]" />
                <span className="ml-4 font-bold tracking-wider text-sm whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                  {t("talk")}
                </span>
                <span className="ml-2 px-1.5 py-0.5 rounded border border-[var(--border-light)] text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                  {t("beta")}
                </span>
              </button>
            )}

            <button onClick={() => openSettings("general")} className="flex items-center w-full p-2 rounded-lg hover:bg-[var(--hover-bg)] transition-colors group/btn overflow-hidden">
              <Settings className="w-6 h-6 flex-shrink-0 text-[var(--text-main)]" />
              <span className="ml-4 font-bold tracking-wider text-sm whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                {t("settings")}
              </span>
            </button>
          </div>

          {(mode === "code" || runningHere.length > 0) && (
            <div
              className="mt-2 flex flex-col gap-1 px-[14px] py-3 no-drag border-t-[3px] overflow-y-auto"
              style={{ borderColor: "var(--border-light)" }}
            >
              {mode === "code" && (
                <>
                  <span className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                    {t("projects")}
                  </span>

                  {projects.map((one) => (
                    // Icon-wide while the rail is collapsed, so the open project's highlight is a whole
                    // rounded box rather than a row cut off at the rail's edge.
                    <div
                      key={one.id}
                      className={`flex items-center w-10 group-hover:w-full overflow-hidden rounded-lg transition-all ${
                        one.id === active.id && !codeHome
                          ? "bg-[var(--hover-bg)]"
                          : "hover:bg-[var(--hover-bg)]"
                      }`}
                    >
                      <button
                        onClick={() => handleSelectWorkspace(one.id)}
                        title={one.rootPath || undefined}
                        aria-current={one.id === active.id && !codeHome}
                        className="flex items-center flex-1 min-w-0 p-2 overflow-hidden"
                      >
                        <Folder className="w-6 h-6 flex-shrink-0 text-[var(--text-main)]" />
                        <span className="ml-4 font-bold tracking-wider text-sm truncate opacity-0 group-hover:opacity-100 transition-opacity">
                          {workspaceLabel(one, t)}
                        </span>
                      </button>

                      <button
                        onClick={(event) => handleRemoveWorkspace(event, one.id)}
                        aria-label={t("removeProject")}
                        title={t("removeProject")}
                        className="hidden group-hover:block flex-shrink-0 mr-2 p-1 rounded opacity-0 group-hover:opacity-60 hover:opacity-100 transition-opacity"
                      >
                        <X className="w-4 h-4 text-[var(--text-muted)]" />
                      </button>
                    </div>
                  ))}

                  <button
                    onClick={handleNewProject}
                    className="flex items-center w-full p-2 rounded-lg hover:bg-[var(--hover-bg)] transition-colors overflow-hidden"
                  >
                    <FolderPlus className="w-6 h-6 flex-shrink-0 text-[var(--text-muted)]" />
                    <span className="ml-4 font-bold tracking-wider text-sm whitespace-nowrap text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity">
                      {t("newProject")}
                    </span>
                  </button>
                </>
              )}

              {runningHere.length > 0 && (
                <div
                  className={mode === "code" ? "mt-2 flex flex-col gap-1 border-t-[3px] pt-2" : "flex flex-col gap-1"}
                  style={{ borderColor: "var(--border-light)" }}
                >
                  <span className="px-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                    {t("working")}
                  </span>

                  {runningHere.map((id) => {
                    const session = store.sessions.find((one) => one.id === id);

                    return (
                      <button
                        key={id}
                        onClick={() => openChat(id)}
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
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0 relative">
        {codeHome && viewMode !== "settings" ? (
          <CodeHome
            projects={projects}
            onOpenFolder={handleNewProject}
            onSelectProject={handleSelectWorkspace}
            t={t}
          />
        ) : viewMode === "history" ? (
          <ChatHistory
            sessions={visibleSessions}
            onSelectChat={selectChat}
            onDeleteChat={handleDeleteChat}
            onExportChat={mode === "chat" ? handleExportChat : undefined}
            settings={settings}
            surface={mode}
          />
        ) : viewMode === "files" ? (
          <Explorer
            settings={settings}
            workspace={active}
            initialPath={canvasPath}
          />
        ) : viewMode === "talk" && mode === "chat" ? (
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
                      selected={canvasPath}
                      onSelect={(entry) =>
                        setCanvas({ workspaceId: active.id, path: entry.path })
                      }
                      t={t}
                    />
                  </div>

                  {shouldShowStrip(gitStatus) && (
                    <GitStrip
                      status={gitStatus}
                      workspaceId={active.id}
                      root={active.rootPath}
                      t={t}
                      onOpenFile={(path) => setCanvas({ workspaceId: active.id, path })}
                    />
                  )}
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

            <div className="flex-1 min-w-0 flex">
            <ChatScreen
            key={mode}
            model={turnModel}
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
            onCompact={() => runs.compact(currentChatId)}
            onSelectModel={selectModelHere}
            onOpenSettings={openSettings}
            onNewChat={handleNewChat}
            surface={mode}
            settings={effectiveSettings}
            onPatchSettings={patchFromComposer}
            permissionMode={mode === "code" ? active.permissionMode : undefined}
            onPermissionMode={
              mode === "code"
                ? (next) => workspaces.setPermissionMode(active.id, next)
                : undefined
            }
            />
            </div>

            {/* One column on the right: with the canvas open the plan sits above it, since chat,
                canvas and plan side by side do not fit a laptop screen. */}
            {(canvasPath || hasPlan) && (
              <div
                className={`flex-shrink-0 flex flex-col border-l-[3px] ${
                  canvasPath ? "w-[42%] min-w-[300px] max-w-[640px]" : "w-64"
                }`}
                style={{ borderColor: "var(--border-light)" }}
              >
                {hasPlan && currentSession?.plan && (
                  <div
                    className={
                      canvasPath
                        ? "max-h-[40%] overflow-y-auto border-b-[3px] flex-shrink-0"
                        : "flex-1 min-h-0"
                    }
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

                {canvasPath && (
                  <div className="flex-1 min-h-0">
                    <Canvas
                      key={canvasPath}
                      workspaceId={active.id}
                      path={canvasPath}
                      t={t}
                      onClose={closeCanvas}
                      onMoved={followCanvas}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-[var(--bg-base)]" />
        )}

        {/* Mounted for the app's life, not only while open: a model download lives here, and
            unmounting aborted the pull whenever the user looked away. */}
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
            chatModel={model}
            request={settingsRequest}
            onUpdate={updateSettings}
            onSelectChatModel={onSelectModel}
            projects={projects}
            activeProjectId={mode === "code" && !codeHome ? active.id : null}
            onAddProject={addProject}
            onRenameProject={(id, name) => void workspaces.rename(id, name)}
            onSetPermissionMode={workspaces.setPermissionMode}
            onRevokeGrant={workspaces.revokeGrant}
            onRemoveProject={(id) => void removeProject(id)}
            onEditProjectMemory={(id) =>
              void openMemoryOf(workspaces.workspaces.find((one) => one.id === id))
            }
            onClearChats={() => clearSide("chat")}
            onClearSessions={() => clearSide("code")}
            onLibraryChange={refreshLibraryReadiness}
          />
        </div>
      </div>
    </div>
  );
}
