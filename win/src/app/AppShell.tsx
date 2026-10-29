import { useShellTabs } from "../terminal/useShellTabs";
import { latestForeground, watchTasks } from "../tasks/taskStore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildLabel } from "./buildLabel";
import { ReleaseNotes } from "../updates/ReleaseNotes";
import { Icon } from "../ui/icons/Icon";
import { Toast } from "../ui/Toast";
import { CommandPalette, type PaletteItem } from "../ui/CommandPalette";
import { ShortcutsSheet } from "../ui/ShortcutsSheet";
import { useApiBridge } from "../api/useApiBridge";
import { useGitStatus } from "../project/useGitStatus";
import SettingsPage from "../settings/SettingsPage";
import type { SettingsRequest } from "../settings/SettingsPage";
import { SETTINGS_GROUPS, type SettingsTab } from "../settings/pages";
import { ConfirmDialog } from "../settings/Controls";
import MemoryEditor from "../project/MemoryEditor";
import { planProgress, type PlanItem } from "../plan/plan";
import { loadProjectMemory } from "../project/load";
import { MEMORY_NAMES } from "../project/memory";
import { draftProjectMemory } from "../project/scan";
import { setUiLanguage, useTranslator } from "../i18n";
import { AnswerQuestionContext } from "../chat/questionContext";
import type { ComposerQueue } from "../chat/Composer";
import { logBreadcrumb, logSwallow, swallowed } from "../logger";
import { chatToHtml, chatToMarkdown, transcriptFilename } from "../chat/transcriptExport";
import { generateId, titleFromContent } from "../utils";
import type { Utterance } from "../voice/conversation";
import { listInstalledModels } from "../llama";
import { isRemote } from "../ai/providers";
import { unregisterGroup } from "../tools/registry";
import type { ToolEnvironment } from "../tools/registry";
import { syncMcpTools } from "../tools/mcp";
import type { McpServerState } from "../tools/mcp";
import { useSessions } from "./useSessions";
import { useAgentRuns } from "./useAgentRuns";
import { useUpdateDialog } from "./useUpdateDialog";
import { ACTIVE_WORKSPACE_KEY, useWorkspaces } from "./useWorkspaces";
import { useShellLayout } from "./useShellLayout";
import { Sidebar } from "./Sidebar";
import { TitleBar } from "./TitleBar";
import { MainColumn } from "./MainColumn";
import { Dock } from "./Dock";
import {
  closePane,
  createDefaultDockLayout,
  filePane,
  migrateFilePane,
  openFilePane,
  openPane,
  type DockLayout,
} from "./dockLayout";
import type { FirstDownload } from "../onboarding/useFirstDownload";
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
import type { AppSettings, Attachment, ChatSession, InstalledSkill, Message, Workspace } from "../types";
import { nextView, type TranscriptView } from "../chat/transcriptView";
import { skillsFor } from "../skills/skills";
import { sameGeneration, startingEffort, useChatGeneration, type Generation } from "./useChatGeneration";
import { useImageEngine } from "../images/useImageEngine";
import { fillComposer } from "../chat/mentions";
import { CrashNotice } from "../CrashNotice";

export type ViewMode = "chat" | "files" | "talk" | "settings";

interface AppShellProps {
  model: string;
  settings: AppSettings;
  onUpdateSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  onSelectModel: (name: string) => void;
  startDownloads?: string[];
  arrivingModel?: FirstDownload;
  seedPrompt?: string;
  onSeedUsed?: () => void;
  openSettingsOn?: SettingsTab;
}

/* Primary desktop window coordinator managing sessions, runtime bridges and dock layouts. */
export default function AppShell({
  model,
  settings,
  onUpdateSettings,
  onSelectModel,
  startDownloads,
  arrivingModel,
  seedPrompt,
  onSeedUsed,
  openSettingsOn,
}: AppShellProps) {
  const t = useTranslator(settings.language);
  setUiLanguage(settings.language);

  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [openedAt] = useState(() => Date.now());
  const [viewMode, setViewMode] = useState<ViewMode>("chat");
  useEffect(() => {
    logBreadcrumb(`screen:${viewMode}`);
  }, [viewMode]);
  // Read again on leaving settings, where an engine or a model may have been installed.
  const imageEngine = useImageEngine(viewMode);
  const [settingsRequest, setSettingsRequest] = useState<SettingsRequest>({
    tab: "general",
    id: 0,
  });
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [removingProjectId, setRemovingProjectId] = useState<string | null>(null);
  const [libraryReady, setLibraryReady] = useState(false);
  const [skills, setSkills] = useState<InstalledSkill[]>([]);
  const [finishedChatId, setFinishedChatId] = useState<string | null>(null);
  const watchingRef = useRef<string | null>(null);
  const [canvas, setCanvas] = useState<{ workspaceId: string; path: string } | null>(null);

  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem("draggy_sidebar_open") !== "false",
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [paletteModels, setPaletteModels] = useState<{ name: string }[]>([]);

  // Refresh installed models when palette opens so choices stay current.
  useEffect(() => {
    if (!paletteOpen) return;
    let live = true;
    listInstalledModels()
      .then((models) => {
        if (live) setPaletteModels(models);
      })
      .catch(swallowed("app", "best effort, the screen works without it"));
    return () => {
      live = false;
    };
  }, [paletteOpen]);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => {
      const next = !prev;
      localStorage.setItem("draggy_sidebar_open", String(next));
      return next;
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

  const codeHome = mode === "code" && !isProject(workspaces.active);
  const active =
    mode === "code"
      ? codeHome
        ? defaultWorkspace
        : workspaces.active
      : isProject(workspaces.active)
        ? defaultWorkspace
        : workspaces.active;

  useEffect(() => {
    logBreadcrumb("workspace:switch", { workspace: active.id, mode });
  }, [active.id, mode]);

  const canvasPath = canvas && canvas.workspaceId === active.id ? canvas.path : null;

  const {
    setTreeOpen,
    rightPaneWidth,
    isNarrow,
    observeWorkArea,
    startResizeRightPane,
  } = useShellLayout({ canvasPath });

  const gitStatus = useGitStatus(active.id, active.rootPath ?? null);
  const [, setFileRevision] = useState(0);

  useEffect(() => {
    const stop = window.electronAPI?.files?.onChanged?.((change: { workspaceId?: string }) => {
      if (change.workspaceId && active && change.workspaceId !== active.id) return;
      setFileRevision((r) => r + 1);
    });
    return () => {
      stop?.();
    };
  }, [active]);

  const closeCanvas = useCallback(() => setCanvas(null), []);
  const followCanvas = useCallback(
    (path: string) =>
      setCanvas((previous) => (previous ? { ...previous, path } : previous)),
    [],
  );

  const effectiveSettings = useMemo(
    () => resolveSettings(settingsForMode(settings, mode), active),
    [settings, mode, active],
  );
  const turnModel = mode === "code" ? effectiveSettings.modelName || model : model;

  const openSettings = useCallback((tab: SettingsTab) => {
    setSettingsRequest((current) => ({ tab, id: current.id + 1 }));
    setViewMode("settings");
  }, []);

  const closeSettings = useCallback(() => {
    setViewMode("chat");
  }, []);

  const [viewToast, setViewToast] = useState<string | null>(null);

  const [openedOn, setOpenedOn] = useState<SettingsTab | undefined>();
  if (openSettingsOn !== openedOn) {
    setOpenedOn(openSettingsOn);
    if (openSettingsOn) openSettings(openSettingsOn);
  }

  const updateSettings = useCallback(
    (patch: Partial<AppSettings>) => onUpdateSettings((current) => ({ ...current, ...patch })),
    [onUpdateSettings],
  );

  // The chat on screen, for the changes made while it is open: they are saved with it.
  const [openChatId, setOpenChatId] = useState<string | null>(null);
  const rememberGeneration = useCallback(
    (change: Partial<Generation>) => {
      if (!openChatId) return;
      store.updateSession(openChatId, (session) => {
        const next = { ...session.generation, ...change };
        return sameGeneration(session.generation, next) ? session : { ...session, generation: next };
      });
    },
    [store, openChatId],
  );

  const patchFromComposer = useCallback(
    (patch: Partial<AppSettings>) => {
      updateSettings(patchForMode(mode, patch));
      if (patch.effort) rememberGeneration({ effort: patch.effort });
    },
    [mode, updateSettings, rememberGeneration],
  );

  const selectModelHere = useCallback(
    (name: string) => {
      logBreadcrumb("model:switch", { mode, model: name });
      rememberGeneration({ model: name });
      if (mode === "chat") {
        onSelectModel(name);
        return;
      }

      // The model loads on the first message sent, never on a switch.
      updateSettings({ codeModel: name });
    },
    [mode, onSelectModel, updateSettings, rememberGeneration],
  );

  useEffect(() => {
    if (!window.electronAPI?.mcp) return;

    const api = window.electronAPI.mcp;

    const call = (
      serverId: string,
      toolName: string,
      args: Record<string, unknown>,
      correlationId?: string,
    ) => api.call(serverId, toolName, args, correlationId);

    const sync = (servers: McpServerState[]) => syncMcpTools(servers, call);

    const stopWatching = api.onState((state) => sync(state.servers));

    api
      .startEnabled()
      .then((result) => sync(result.servers ?? []))
      .catch(swallowed("app", "the main process already logged this call"));

    return () => {
      stopWatching();
      unregisterGroup("external");
    };
  }, []);

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

  useEffect(() => {
    const api = window.electronAPI?.skills;
    if (!api) return;

    let cancelled = false;

    api
      .list(active.id)
      .then((result) => {
        if (!cancelled) setSkills(skillsFor(result?.skills ?? [], mode));
      })
      .catch(swallowed("app", "the main process already logged this call"));

    return () => {
      cancelled = true;
    };
  }, [active.id, viewMode, mode]);

  const environment: ToolEnvironment = {
    webMode: effectiveSettings.webMode,
    browserActions: effectiveSettings.browserActions !== false,
    codeExecution: false,
    canRunCommands: mode === "code" && Boolean(window.electronAPI?.commands),
    libraryReady: mode === "chat" && libraryReady && effectiveSettings.libraryEnabled,
    hasFolder: Boolean(active.rootPath),
    projectRoot: active.rootPath ?? undefined,
    hasSkills: skills.length > 0,
    hasGit: Boolean(active.rootPath && gitStatus?.available && gitStatus.isRepo),
    imageReady: imageEngine.ready,
  };

  useApiBridge({ model, settings: settingsForMode(settings, "chat"), t });

  // Proceeding out of plan mode sends only after the new mode has rendered, so the turn that
  // carries out the plan is not refused by the plan-mode permission it was approved from.
  const proceedChatRef = useRef<string | null>(null);

  const runs = useAgentRuns({
    model: turnModel,
    settings: effectiveSettings,
    environment,
    workspaceId: active.id,
    permission: { mode: active.permissionMode, grants: active.grants },
    onGrant: workspaces.addGrant,
    onFinished: (chatId) => {
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
  // Read again when a reply starts or ends, which is when a model gets loaded.

  useEffect(() => {
    const chatId = proceedChatRef.current;
    if (!chatId || active.permissionMode === "plan") return;
    proceedChatRef.current = null;
    runs.send(chatId, t("planProceedPrompt"));
  }, [active.permissionMode, runs, t]);

  const handleDeleteChat = useCallback(
    (e: React.MouseEvent, chatId: string) => {
      e.stopPropagation();
      runs.stop(chatId);
      store.deleteSession(chatId);
      setSelectedChatId((current) => (current === chatId ? null : current));
    },
    [runs, store],
  );

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
    // By the user's rule, a new chat starts at the default level or stays where the last one was moved to.
    const effort = startingEffort(settings.newChatStart, settings.effort, settings.defaultEffort);
    const codeEffort = startingEffort(settings.newChatStart, settings.codeEffort, settings.codeDefaultEffort);
    if (settings.effort !== effort || settings.codeEffort !== codeEffort) updateSettings({ effort, codeEffort });
  }, [settings.newChatStart, settings.effort, settings.defaultEffort, settings.codeEffort, settings.codeDefaultEffort, updateSettings]);

  // Global hotkeys for palette, shortcuts, sidebar, new session and settings.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const modifier = e.ctrlKey || e.metaKey;
      if (!modifier || e.altKey) return;

      if ((e.key.toLowerCase() === "k" && !e.shiftKey) || (e.key.toLowerCase() === "p" && e.shiftKey)) {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      } else if (e.key === "/" && !e.shiftKey) {
        e.preventDefault();
        setShortcutsOpen((prev) => !prev);
      } else if (e.key.toLowerCase() === "b" && !e.shiftKey) {
        e.preventDefault();
        toggleSidebar();
      } else if (e.key.toLowerCase() === "n" && !e.shiftKey) {
        e.preventDefault();
        handleNewChat();
      } else if (e.key === "," && !e.shiftKey) {
        e.preventDefault();
        openSettings("general");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebar, handleNewChat, openSettings]);

  const selectChat = useCallback((id: string) => {
    setSelectedChatId(id);
    setViewMode("chat");
  }, []);

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

  const removeProject = useCallback(
    async (id: string) => {
      for (const session of sessionsIn(store.sessions, id)) runs.stop(session.id);

      const { removed } = await workspaces.remove(id);
      if (removed) store.forgetWorkspace(id);
      setSelectedChatId(null);
    },
    [workspaces, store, runs],
  );

  const handleRemoveWorkspace = useCallback((id: string) => setRemovingProjectId(id), []);

  const visibleSessions = useMemo(
    () => sessionsIn(store.sessions, active.id),
    [store.sessions, active.id],
  );

  // The sidebar lists every project's sessions in Code, so a folder you are not in still shows its chats.
  // Chat lists the sessions that sit in no project.
  const sidebarSessions = useMemo(() => {
    const projectIds = new Set(projects.map((project) => project.id));
    return store.sessions.filter((session) => projectIds.has(workspaceIdOf(session)) === (mode === "code"));
  }, [store.sessions, projects, mode]);

  const blankChatId = `blank-${active.id}`;

  const currentChatId = store.hydrated
    ? (selectedChatId ?? visibleSessions[0]?.id ?? blankChatId)
    : selectedChatId;

  const measureConversation = runs.measure;
  const queueChatId = currentChatId ?? null;
  const composerQueue: ComposerQueue | undefined = queueChatId
    ? {
        chatId: queueChatId,
        queue: runs.queues[queueChatId] ?? [],
        pendingSteers: runs.pendingSteers[queueChatId] ?? [],
        enqueue: (content, attachments) => runs.enqueue(queueChatId, content, attachments),
        steer: (content) => runs.steer(queueChatId, content),
        sendNow: (content, attachments) => runs.sendNow(queueChatId, content, attachments),
        editQueued: (id, content) => runs.editQueued(queueChatId, id, content),
        removeQueued: (id) => runs.removeQueued(queueChatId, id),
        moveQueued: (id, offset) => runs.moveQueued(queueChatId, id, offset),
        sendQueuedNow: (id) => runs.sendQueuedNow(queueChatId, id),
      }
    : undefined;
  const measureContext = useCallback(
    (
      draft: string,
      attachments: Attachment[],
      options: { signal: AbortSignal; allowLoad: boolean },
    ) =>
      currentChatId
        ? measureConversation(currentChatId, draft, attachments, options)
        : Promise.resolve(null),
    [measureConversation, currentChatId],
  );

  useEffect(() => {
    watchingRef.current = viewMode === "chat" ? currentChatId : null;
  });

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

  const onUpdatesPage = viewMode === "settings" && settingsTab === "updates";
  const currentSession = visibleSessions.find((s) => s.id === currentChatId);
  if (openChatId !== currentChatId) setOpenChatId(currentChatId);

  useChatGeneration({
    ready: store.hydrated && viewMode === "chat",
    chatId: currentChatId,
    session: currentSession,
    mode,
    allowMaxInChat: settings.allowMaxInChat,
    effort: effectiveSettings.effort,
    model: turnModel,
    canUseModel: async (name) => isRemote(name) || (await listInstalledModels()).some((entry) => entry.name === name),
    applyEffort: (effort) => updateSettings(patchForMode(mode, { effort })),
    applyModel: (name) => (mode === "chat" ? onSelectModel(name) : updateSettings({ codeModel: name })),
    save: (id, generation) =>
      store.updateSession(id, (session) => (sameGeneration(session.generation, generation) ? session : { ...session, generation })),
  });

  /** A finished spoken turn, kept in the chat Talk is a view of. The first one starts the chat. */
  const handleTalkTurn = useCallback(
    (turn: Utterance) => {
      if (!currentChatId) return;
      const message: Message = { id: generateId(), role: turn.role, content: turn.text };
      if (!store.getSession(currentChatId)) {
        store.addSession({
          id: currentChatId,
          workspaceId: active.id,
          title: titleFromContent(turn.text, t("newDiscussion")),
          messages: [message],
          updatedAt: Date.now(),
          isGenerating: false,
        });
        return;
      }
      store.updateSession(currentChatId, (session) => ({
        ...session,
        messages: [...session.messages, message],
        updatedAt: Date.now(),
      }));
    },
    [active.id, currentChatId, store, t],
  );

  const transcriptView = currentSession?.view ?? "normal";
  // Panes live beside the transcript: not in Settings or other pages, and diff and plan only in Code.
  const panesUsable = viewMode === "chat";
  const codePanes = panesUsable && mode === "code";
  const canChangeView = Boolean(currentSession) && viewMode === "chat";
  const setTranscriptView = useCallback(
    (view: TranscriptView) => {
      if (currentChatId) store.updateSession(currentChatId, (s) => ({ ...s, view }));
    },
    [currentChatId, store],
  );

  // Ctrl+O steps through Normal, Thinking and Verbose for the open chat.
  useEffect(() => {
    if (!canChangeView) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "o") return;
      e.preventDefault();
      const next = nextView(transcriptView);
      setTranscriptView(next);
      const label =
        next === "normal"
          ? t("transcriptNormal")
          : next === "thinking"
            ? t("transcriptThinking")
            : t("transcriptVerbose");
      setViewToast(`${t("viewMode")}: ${label}`);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canChangeView, transcriptView, setTranscriptView, t]);

  // Ctrl+Tab goes to the next most recent session of this mode, Ctrl+Shift+Tab back.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey || e.key !== "Tab") return;
      const recent = [...visibleSessions].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      if (recent.length < 2) return;
      e.preventDefault();
      const index = recent.findIndex((s) => s.id === currentChatId);
      const next = recent[(index + (e.shiftKey ? -1 : 1) + recent.length) % recent.length];
      selectChat(next.id);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [visibleSessions, currentChatId, selectChat]);
  const runningHere = runningInMode(runs.running, store.sessions, workspaces.workspaces, mode);
  const hasPlan = Boolean(currentSession?.plan && currentSession.plan.length > 0);

  const [dockLayoutsByChat, setDockLayoutsByChat] = useState<Record<string, DockLayout>>({});

  const currentDockLayout = useMemo<DockLayout>(() => {
    const stored =
      currentSession?.dock ??
      (currentChatId ? dockLayoutsByChat[currentChatId] : undefined);
    const saved = stored ? migrateFilePane(stored) : undefined;
    let base =
      saved ??
      createDefaultDockLayout({
        file: canvasPath,
        width: rightPaneWidth,
      });
    if (canvasPath && !base.panes.includes(filePane(canvasPath))) {
      base = openFilePane(base, canvasPath);
    } else if (canvasPath && base.file !== canvasPath) {
      base = { ...base, file: canvasPath };
    }
    return { ...base, width: rightPaneWidth };
  }, [
    currentSession?.dock,
    currentChatId,
    dockLayoutsByChat,
    canvasPath,
    rightPaneWidth,
  ]);

  const updateDockLayout = useCallback(
    (next: DockLayout) => {
      if (currentChatId) {
        setDockLayoutsByChat((prev) => ({ ...prev, [currentChatId]: next }));
        store.updateSession(currentChatId, (s) => ({ ...s, dock: next }));
      }
    },
    [currentChatId, store],
  );

  // Opens the plan pane once when a plan first appears, so the user can close it afterwards.
  const prevPlan = useRef({ chat: currentChatId, has: hasPlan });
  useEffect(() => {
    const prev = prevPlan.current;
    prevPlan.current = { chat: currentChatId, has: hasPlan };
    if (prev.chat === currentChatId && !prev.has && hasPlan && !currentDockLayout.panes.includes("plan")) {
      updateDockLayout(openPane(currentDockLayout, "plan"));
    }
  }, [currentChatId, hasPlan, currentDockLayout, updateDockLayout]);

  // F6 cycles between regions: sidebar, transcript, composer, dock.
  useEffect(() => {
    const handleF6 = (e: KeyboardEvent) => {
      if (e.key !== "F6") return;
      e.preventDefault();
      const regions = ["sidebar", "transcript", "composer", "dock"]
        .map((r) => document.querySelector<HTMLElement>(`[data-region="${r}"]`))
        .filter((el): el is HTMLElement => Boolean(el && el.offsetParent !== null && !el.hasAttribute("inert")));

      if (regions.length === 0) return;
      const activeEl = document.activeElement;
      const currentIndex = regions.findIndex((r) => r.contains(activeEl));
      const delta = e.shiftKey ? -1 : 1;
      const nextIndex = (currentIndex + delta + regions.length) % regions.length;
      const nextRegion = regions[nextIndex];
      const focusTarget =
        nextRegion.querySelector<HTMLElement>("input, textarea, button, [tabindex='0']") ?? nextRegion;
      focusTarget.focus();
    };
    window.addEventListener("keydown", handleF6);
    return () => window.removeEventListener("keydown", handleF6);
  }, []);

  const handleOpenDiff = useCallback(
    (filePath?: string) => {
      updateDockLayout(openPane(currentDockLayout, "diff", { diffFile: filePath, file: filePath }));
    },
    [currentDockLayout, updateDockLayout],
  );

  const handleOpenFiles = useCallback(() => {
    if (active.rootPath) {
      updateDockLayout(openPane(currentDockLayout, "files"));
    } else {
      setViewMode("files");
    }
  }, [active.rootPath, currentDockLayout, updateDockLayout]);

  const handleOpenFile = useCallback(
    (path: string) => {
      setCanvas({ workspaceId: active.id, path });
      updateDockLayout(openFilePane(currentDockLayout, path));
    },
    [active.id, currentDockLayout, updateDockLayout],
  );

  const handleOpenBrowser = useCallback(() => {
    updateDockLayout(openPane(currentDockLayout, "browser"));
  }, [currentDockLayout, updateDockLayout]);

  // Each shell is a dock tab. A Run button in a code block also lands here, with a command for a prompt.
  const { openShell } = useShellTabs({
    workspaceId: active.id,
    defaultShell: settings.defaultShell,
    layout: currentDockLayout,
    onLayoutChange: updateDockLayout,
    onMessage: setViewToast,
    t,
  });

  // The context wheel's usage link opens the Statistics page in Settings.
  const handleOpenUsage = useCallback(() => openSettings("usage"), [openSettings]);

  // A link clicked anywhere in the app loads in the Browser pane; main asks for the pane to show.
  const openBrowserRef = useRef(handleOpenBrowser);
  useEffect(() => {
    openBrowserRef.current = handleOpenBrowser;
  });
  useEffect(() => window.electronAPI?.browserPane?.onOpen(() => openBrowserRef.current()), []);

  useEffect(() => {
    const handleShortcuts = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "f") {
        e.preventDefault();
        handleOpenFiles();
      } else if (key === "d") {
        e.preventDefault();
        handleOpenDiff();
      } else if (key === "b") {
        e.preventDefault();
        handleOpenBrowser();
      } else if (key === "l" && mode === "code" && viewMode === "chat") {
        e.preventDefault();
        updateDockLayout(openPane(currentDockLayout, "plan"));
      } else if (key === "x") {
        e.preventDefault();
        handleSwitchMode(mode === "chat" ? "code" : "chat");
      } else if (key === " ") {
        e.preventDefault();
        if (mode !== "chat") enterMode("chat");
        setViewMode("talk");
      }
    };
    window.addEventListener("keydown", handleShortcuts);
    return () => window.removeEventListener("keydown", handleShortcuts);
  }, [handleOpenFiles, handleOpenDiff, handleOpenBrowser, handleSwitchMode, enterMode, mode, viewMode, updateDockLayout, currentDockLayout]);

  // Ctrl+Shift+T opens a new terminal; the backtick needs AltGr on AZERTY.
  useEffect(() => {
    const handleTerminal = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || !e.shiftKey || e.key.toLowerCase() !== "t" || !active.rootPath) return;
      e.preventDefault();
      void openShell();
    };
    window.addEventListener("keydown", handleTerminal);
    return () => window.removeEventListener("keydown", handleTerminal);
  }, [active.rootPath, openShell]);

  // Task events reach the chip and the Tasks tab from the first command on.
  useEffect(() => watchTasks(), []);

  // Ctrl+Alt+B sends the command the agent is running to the background.
  useEffect(() => {
    const handleBackground = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || e.shiftKey || e.key.toLowerCase() !== "b") return;
      const runId = latestForeground();
      if (!runId) return;
      e.preventDefault();
      void window.electronAPI?.commands?.detach(runId);
    };
    window.addEventListener("keydown", handleBackground);
    return () => window.removeEventListener("keydown", handleBackground);
  }, []);

  // Ctrl+\ closes the active pane in the dock.
  useEffect(() => {
    const handleClosePane = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key !== "\\") return;
      if (currentDockLayout.active) {
        e.preventDefault();
        updateDockLayout(closePane(currentDockLayout, currentDockLayout.active));
      }
    };
    window.addEventListener("keydown", handleClosePane);
    return () => window.removeEventListener("keydown", handleClosePane);
  }, [currentDockLayout, updateDockLayout]);

  const paletteItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [
      {
        id: "action-new",
        label: mode === "code" && codeHome ? t("newProject") : mode === "code" ? t("newSession") : t("newDiscussion"),
        category: t("paletteSectionActions"),
        icon: "plus",
        shortcut: "Ctrl+N",
        onSelect: () => {
          setPaletteOpen(false);
          if (mode === "code" && codeHome) handleNewProject();
          else handleNewChat();
        },
      },
      {
        id: "action-toggle-sidebar",
        label: t("toggleSidebar"),
        category: t("paletteSectionActions"),
        icon: "sidebar-simple",
        shortcut: "Ctrl+B",
        onSelect: () => {
          setPaletteOpen(false);
          toggleSidebar();
        },
      },
      {
        id: "action-switch-mode",
        label: mode === "chat" ? t("codeMode") : t("chatMode"),
        category: t("paletteSectionActions"),
        icon: mode === "chat" ? "code" : "chat-circle",
        shortcut: "Ctrl+Shift+X",
        onSelect: () => {
          setPaletteOpen(false);
          handleSwitchMode(mode === "chat" ? "code" : "chat");
        },
      },
      ...(imageEngine.ready && mode === "chat"
        ? [
            {
              id: "action-image",
              label: t("generateImageCommand"),
              category: t("paletteSectionActions"),
              icon: "image" as const,
              onSelect: () => {
                setPaletteOpen(false);
                setViewMode("chat");
                // The composer may not be on screen yet when leaving another page.
                setTimeout(() => fillComposer("/image "), 0);
              },
            },
          ]
        : []),
      {
        id: "action-shortcuts",
        label: t("keyboardShortcuts"),
        category: t("paletteSectionActions"),
        icon: "keyboard",
        shortcut: "Ctrl+/",
        onSelect: () => {
          setPaletteOpen(false);
          setShortcutsOpen(true);
        },
      },
      {
        id: "pane-files",
        label: t("files"),
        category: t("paletteSectionPanes"),
        icon: "folder-simple",
        shortcut: "Ctrl+Shift+F",
        onSelect: () => {
          setPaletteOpen(false);
          handleOpenFiles();
        },
      },
      {
        id: "pane-diff",
        label: t("diffPane"),
        category: t("paletteSectionPanes"),
        icon: "git-diff",
        shortcut: "Ctrl+Shift+D",
        onSelect: () => {
          setPaletteOpen(false);
          handleOpenDiff();
        },
      },
      {
        id: "pane-browser",
        label: t("browser"),
        category: t("paletteSectionPanes"),
        icon: "globe-simple",
        shortcut: "Ctrl+Shift+B",
        onSelect: () => {
          setPaletteOpen(false);
          handleOpenBrowser();
        },
      },
      ...(active.rootPath
        ? [
            {
              id: "pane-terminal",
              label: t("terminal"),
              category: t("paletteSectionPanes"),
              icon: "terminal-window" as const,
              shortcut: "Ctrl+Shift+T",
              onSelect: () => {
                setPaletteOpen(false);
                void openShell();
              },
            },
          ]
        : []),
      ...(currentDockLayout.active
        ? [
            {
              id: "pane-close",
              label: t("closePane"),
              category: t("paletteSectionPanes"),
              icon: "x" as const,
              shortcut: "Ctrl+\\",
              onSelect: () => {
                setPaletteOpen(false);
                if (currentDockLayout.active) updateDockLayout(closePane(currentDockLayout, currentDockLayout.active));
              },
            },
          ]
        : []),
      {
        id: "pane-plan",
        label: t("plan"),
        category: t("paletteSectionPanes"),
        icon: "check",
        shortcut: "Ctrl+Shift+L",
        onSelect: () => {
          setPaletteOpen(false);
          updateDockLayout(openPane(currentDockLayout, "plan"));
        },
      },
    ];

    for (const group of SETTINGS_GROUPS) {
      for (const page of group.pages) {
        items.push({
          id: `settings-${page.id}`,
          label: `${t("settings")}: ${t(page.label)}`,
          category: t("paletteSectionSettings"),
          icon: page.icon,
          onSelect: () => {
            setPaletteOpen(false);
            openSettings(page.id);
          },
        });
      }
    }

    for (const s of store.sessions) {
      items.push({
        id: `session-${s.id}`,
        label: s.title || t("newDiscussion"),
        category: t("paletteSectionSessions"),
        icon: "chat-circle",
        onSelect: () => {
          setPaletteOpen(false);
          openChat(s.id);
        },
      });
    }

    for (const p of projects) {
      items.push({
        id: `project-${p.id}`,
        label: workspaceLabel(p, t),
        category: t("paletteSectionProjects"),
        icon: "folder-simple",
        onSelect: () => {
          setPaletteOpen(false);
          handleSelectWorkspace(p.id);
        },
      });
    }

    for (const m of paletteModels) {
      items.push({
        id: `model-${m.name}`,
        label: m.name,
        category: t("paletteSectionModels"),
        icon: "cpu",
        onSelect: () => {
          setPaletteOpen(false);
          selectModelHere(m.name);
        },
      });
    }

    return items;
  }, [
    mode,
    codeHome,
    t,
    handleNewProject,
    handleNewChat,
    toggleSidebar,
    handleSwitchMode,
    handleOpenFiles,
    handleOpenDiff,
    handleOpenBrowser,
    openShell,
    active.rootPath,
    updateDockLayout,
    currentDockLayout,
    openSettings,
    store.sessions,
    openChat,
    projects,
    handleSelectWorkspace,
    paletteModels,
    selectModelHere,
    imageEngine.ready,
  ]);

  return (
    <AnswerQuestionContext.Provider value={runs.answerQuestion}>
    <div className="w-screen h-screen overflow-hidden flex flex-col transition-colors duration-300 bg-surface-canvas text-text-primary">
      <CrashNotice t={t} onExport={() => openSettings("diagnostics")} />
      <TitleBar
        t={t}
        projectName={isProject(active) ? workspaceLabel(active, t) : undefined}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
        diffStats={
          codePanes && gitStatus
            ? {
                added: (gitStatus.counts?.added ?? 0) + (gitStatus.counts?.untracked ?? 0),
                modified: (gitStatus.counts?.modified ?? 0) + (gitStatus.counts?.renamed ?? 0),
                removed: gitStatus.counts?.deleted ?? 0,
              }
            : null
        }
        onOpenDiff={codePanes ? () => handleOpenDiff() : undefined}
        onOpenFiles={panesUsable ? handleOpenFiles : undefined}
        onOpenBrowser={panesUsable ? handleOpenBrowser : undefined}
        onOpenTerminal={panesUsable ? () => void openShell() : undefined}
        onOpenPlan={codePanes ? () => updateDockLayout(openPane(currentDockLayout, "plan")) : undefined}
        planProgress={
          codePanes && currentChatId && runs.running.includes(currentChatId) && currentSession?.plan?.length
            ? planProgress(currentSession.plan, t)
            : null
        }
        viewMode={transcriptView}
        onChangeViewMode={canChangeView ? setTranscriptView : undefined}
      />

      <div className="flex-1 w-full flex min-h-0 overflow-hidden relative">
        {update.ready !== null && !update.dismissed && !onUpdatesPage && (
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50"
            role="dialog"
            aria-modal="true"
            aria-labelledby="update-ready-title"
          >
            <div className="mx-4 w-full max-w-sm rounded-2xl border border-rule bg-surface-raised p-6 shadow-xl">
              <h2
                id="update-ready-title"
                className="text-base font-semibold"
              >
                {t("updateReadyTitle")}
              </h2>

              <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
                {update.ready
                  ? `${t("updateReadyBody")} (${buildLabel(update.ready, t)})`
                  : t("updateReadyBody")}
              </p>

              {update.notes && (
                <div className="mt-3">
                  <ReleaseNotes notes={update.notes} t={t} />
                </div>
              )}

              <div className="mt-5 flex gap-2">
                <button
                  onClick={() => window.electronAPI?.updater.install()}
                  className="flex-1 rounded-xl bg-[var(--bg-inverted)] px-4 py-2.5 text-xs font-medium text-action-fg transition-opacity hover:opacity-90"
                >
                  {t("updateInstallNow")}
                </button>

                <button
                  onClick={update.dismiss}
                  className="flex-1 rounded-xl border border-rule px-4 py-2.5 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary"
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
                workspaces.workspaces.find(
                  (one) => one.id === removingProjectId,
                ),
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

        <Toast
          open={Boolean(finishedChatId)}
          onClose={() => setFinishedChatId(null)}
          icon={<Icon name="check" size={16} className="text-text-secondary" />}
          title={t("taskFinished")}
          description={store.sessions.find((one) => one.id === finishedChatId)?.title}
          action={{
            label: t("openSession"),
            onClick: () => {
              if (finishedChatId) openChat(finishedChatId);
              setFinishedChatId(null);
            },
          }}
        />

        <Toast
          open={Boolean(store.storageWarning)}
          onClose={() => store.setStorageWarning(null)}
          tone="danger"
          title={store.storageWarning ?? undefined}
        />

        <Toast
          open={Boolean(viewToast)}
          onClose={() => setViewToast(null)}
          duration={1500}
          title={viewToast ?? undefined}
        />

        <Sidebar
          mode={mode}
          codeHome={codeHome}
          activeWorkspaceId={active.id}
          projects={projects}
          runningSessionIds={runningHere}
          sessions={sidebarSessions}
          currentChatId={currentChatId}
          t={t}
          onSwitchMode={handleSwitchMode}
          onNewChat={handleNewChat}
          onNewProject={handleNewProject}
          onSelectChat={selectChat}
          onDeleteChat={handleDeleteChat}
          onRenameChat={(id, newTitle) => {
            store.updateSession(id, (s) => ({ ...s, title: newTitle }));
          }}
          onPinChat={(id) => {
            store.updateSession(id, (s) => ({ ...s, pinned: !s.pinned }));
          }}
          onExportChat={(id, format) => {
            const session = store.sessions.find((s) => s.id === id);
            if (!session) return;
            const now = new Date();
            const content = format === "html" ? chatToHtml(session, { now }) : chatToMarkdown(session, { now });
            window.electronAPI
              ?.exportChat({ defaultName: transcriptFilename(session, format, now), content, ext: format })
              ?.catch((error: unknown) => logSwallow("chat", error, "the export was not saved"));
          }}
          onViewTalk={() => {
            setSelectedChatId(generateId());
            setViewMode("talk");
          }}
          onOpenSettings={openSettings}
          onSelectWorkspace={handleSelectWorkspace}
          onRemoveWorkspace={handleRemoveWorkspace}
          open={sidebarOpen}
          onToggleOpen={toggleSidebar}
          onOpenPalette={() => setPaletteOpen(true)}
        />

        <MainColumn
          arrivingModel={arrivingModel}
          settings={settings}
          t={t}
          viewMode={viewMode}
          mode={mode}
          codeHome={codeHome}
          projects={projects}
          active={active}
          canvasPath={canvasPath}
          currentChatId={currentChatId}
          currentSession={currentSession}
          openedAt={openedAt}
          turnModel={turnModel}
          skills={skills}
          effectiveSettings={effectiveSettings}
          gitStatus={gitStatus}
          seedPrompt={seedPrompt}
          observeWorkArea={observeWorkArea}
          onSetTreeOpen={setTreeOpen}
          onSelectWorkspace={handleSelectWorkspace}
          onNewProject={handleNewProject}
          onOpenProjectMemory={() => void openProjectMemory()}
          onSelectFile={handleOpenFile}
          onSendMessage={(content, attachments) =>
            runs.send(currentChatId!, content, attachments)
          }
          onRegenerateChat={onRegenerateChat}
          onSwitchVersionChat={onSwitchVersionChat}
          onEditMessageChat={onEditMessageChat}
          onStopGeneration={() => runs.stop(currentChatId!)}
          onContinueGeneration={() => runs.continueGeneration(currentChatId!)}
          onApproval={runs.answerApproval}
          onRevert={handleRevert}
          onInitProject={draftProject}
          onCompact={() => runs.compact(currentChatId!)}
          onImageCommand={(argument, attachments) => runs.image(currentChatId!, argument, attachments)}
          composerQueue={composerQueue}
          onOpenUsage={handleOpenUsage}
          onMeasureContext={measureContext}
          onSelectModel={selectModelHere}
          onOpenSettings={openSettings}
          onNewChat={handleNewChat}
          onTalkTurn={handleTalkTurn}
          onLeaveTalk={() => setViewMode("chat")}
          onSeedUsed={onSeedUsed}
          patchFromComposer={patchFromComposer}
          onPermissionMode={
            mode === "code"
              ? (next) => workspaces.setPermissionMode(active.id, next)
              : undefined
          }
          onOpenDiff={handleOpenDiff}
          dockNode={
            <Dock
              layout={currentDockLayout}
              onLayoutChange={updateDockLayout}
              canvasPath={canvasPath}
              hasPlan={hasPlan}
              planItems={currentSession?.plan}
              isRunning={runs.running.includes(currentChatId!)}
              width={currentDockLayout.width}
              workspaceId={active.id}
              rootPath={active.rootPath}
              onNewShell={(shell) => void openShell(shell)}
              gitStatus={gitStatus}
              t={t}
              onStartResize={startResizeRightPane}
              onPlanChange={(items: PlanItem[]) =>
                store.updateSession(currentChatId!, (session) => ({
                  ...session,
                  plan: items,
                }))
              }
              onContinuePlan={() =>
                runs.send(currentChatId!, t("continuePlan"))
              }
              awaitingPlanReview={mode === "code" && active.permissionMode === "plan"}
              onProceedPlan={() => {
                if (!currentChatId) return;
                proceedChatRef.current = currentChatId;
                workspaces.setPermissionMode(active.id, "ask");
              }}
              onCloseCanvas={closeCanvas}
              onFollowCanvas={followCanvas}
              onOpenFile={(path) => setCanvas({ workspaceId: active.id, path })}
              onSendReviewComment={(prompt) =>
                currentChatId && runs.send(currentChatId, prompt)
              }
              isOverlay={isNarrow}
            />
          }
        />

        <div
          className={
            viewMode === "settings"
              ? "absolute inset-0 z-20 flex flex-col bg-[var(--bg-base)]"
              : "absolute inset-0 z-20 flex flex-col bg-[var(--bg-base)] invisible pointer-events-none [content-visibility:hidden]"
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
              void openMemoryOf(
                workspaces.workspaces.find((one) => one.id === id),
              )
            }
            onClearChats={() => clearSide("chat")}
            onClearSessions={() => clearSide("code")}
            onLibraryChange={refreshLibraryReadiness}
            onTabChange={setSettingsTab}
            startDownloads={startDownloads}
            onClose={closeSettings}
          />
        </div>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={paletteItems}
        t={t}
      />

      <ShortcutsSheet
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        t={t}
      />
    </div>
    </AnswerQuestionContext.Provider>
  );
}
