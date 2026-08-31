import { useState, useEffect, useRef, useCallback } from "react";
import { Plus, MessageSquare, Settings, AudioLines, FolderOpen } from "lucide-react";
import ChatScreen from "./ChatScreen";
import SettingsPage from "./SettingsPage";
import type { SettingsTab } from "./SettingsPage";
import StartupScreen from "./StartupScreen";
import ChatHistory from "./ChatHistory";
import TalkScreen from "./TalkScreen";
import CreatedFiles from "./CreatedFiles";
import { translations } from "./translations";
import {
  generateId,
  safeJsonParse,
  titleFromContent,
  writeLocalStorage,
} from "./utils";
import { isCloudModel, warmModel } from "./ollama";
import { registerBuiltinTools } from "./tools/builtin";
import type { ToolEnvironment } from "./tools/registry";
import { KEEP_ALIVE, runAgentTurn } from "./agent/agentLoop";
import {
  SETTINGS_KEY,
  cancelSessionSave,
  flushSessionSaves,
  migrateFromLocalStorage,
  queueSessionSave,
  storageBackend,
} from "./storage";
import type {
  ChatSession,
  AppSettings,
  Message,
  MessageVersion,
  Attachment,
  SearchStep,
  TurnMetrics,
} from "./types";

registerBuiltinTools();

const defaultSettings: AppSettings = {
  theme: "light",
  fontSize: "base",
  language: "en",
  // Empty means "not chosen yet": the startup screen adopts whatever is
  // already installed, and sizes a model to the graphics card if nothing is.
  modelName: "",
  customInstructions: [],
  thinkingMode: "medium",
  webMode: "auto",
  voiceName: "",
  voiceModel: "",
  voiceEngine: "system",
  neuralVoice: "af_heart",
  voiceRate: 1,
  searchProvider: "auto",
  searxngUrl: "",
  braveApiKey: "",
  codeExecution: false,
  libraryEnabled: true,
  embedModel: "",
  showMetrics: true,
  autoUpdate: true,
};

const FONT_SIZES = { sm: "13px", base: "15px", lg: "18px" };

function loadSettings(): AppSettings {
  const saved = localStorage.getItem(SETTINGS_KEY);
  const parsed = saved ? safeJsonParse<Partial<AppSettings>>(saved) : null;
  return parsed ? { ...defaultSettings, ...parsed } : defaultSettings;
}

export default function App() {
  const isSplashMode = window.location.search.includes("splash=true");
  const [settings, setSettings] = useState<AppSettings>(loadSettings);

  const [model, setModel] = useState<string | null>(
    isSplashMode || isCloudModel(settings.modelName) ? null : settings.modelName,
  );
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<
    "chat" | "history" | "files" | "talk" | "settings"
  >("chat");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("appearance");
  const [libraryReady, setLibraryReady] = useState(false);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(isSplashMode);

  const openSettings = useCallback((tab: SettingsTab) => {
    setSettingsTab(tab);
    setViewMode("settings");
  }, []);

  const t = useCallback(
    (key: string) =>
      translations[settings.language]?.[key] || translations["en"][key] || key,
    [settings.language],
  );

  const abortControllers = useRef<{ [chatId: string]: AbortController }>({});
  const sessionsRef = useRef(sessions);
  const settingsRef = useRef(settings);

  useEffect(() => {
    sessionsRef.current = sessions;
    settingsRef.current = settings;
  }, [sessions, settings]);

  useEffect(() => {
    if (isSplashMode) return;
    let cancelled = false;

    (async () => {
      await migrateFromLocalStorage();
      const restored = await storageBackend().loadSessions();
      if (cancelled) return;

      setSessions(restored);
      setHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [isSplashMode]);

  useEffect(() => {
    if (isSplashMode) return;

    writeLocalStorage(SETTINGS_KEY, JSON.stringify(settings));
    storageBackend()
      .saveSettings(settings)
      .catch(() => undefined);
  }, [settings, isSplashMode]);

  useEffect(() => {
    window.electronAPI
      ?.setSearchConfig({
        searchProvider: settings.searchProvider,
        searxngUrl: settings.searxngUrl,
        braveApiKey: settings.braveApiKey,
      })
      .catch(() => undefined);
  }, [settings.searchProvider, settings.searxngUrl, settings.braveApiKey]);

  // The main process owns the update schedule, so it has to be told what the
  // setting says — at startup as much as when it is changed.
  useEffect(() => {
    if (isSplashMode) return;
    window.electronAPI?.updater
      .configure({ automatic: settings.autoUpdate })
      .catch(() => undefined);
  }, [settings.autoUpdate, isSplashMode]);

  const refreshLibraryReadiness = useCallback(() => {
    if (!settings.libraryEnabled || !window.electronAPI?.library) {
      setLibraryReady(false);
      return;
    }

    window.electronAPI.library
      .stats()
      .then((result) => setLibraryReady(Boolean(result?.stats && result.stats.chunks > 0)))
      .catch(() => setLibraryReady(false));
  }, [settings.libraryEnabled]);

  useEffect(refreshLibraryReadiness, [refreshLibraryReadiness, viewMode]);

  const persistSession = useCallback((session: ChatSession) => {
    queueSessionSave(session, (_saved, reason) =>
      setStorageWarning(
        reason
          ? `Could not save this conversation: ${reason}`
          : "Could not save this conversation to disk.",
      ),
    );
  }, []);

  useEffect(() => {
    if (isSplashMode) return;

    const flush = () => {
      void flushSessionSaves(sessionsRef.current);
    };

    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, [isSplashMode]);

  useEffect(() => {
    if (settings.theme === "dark") document.body.classList.add("dark");
    else document.body.classList.remove("dark");

    document.documentElement.style.setProperty(
      "--chat-font-size",
      FONT_SIZES[settings.fontSize],
    );
  }, [settings.theme, settings.fontSize]);

  useEffect(() => {
    if (isSplashMode) return;
    window.electronAPI?.onBootModel((bootModel) => {
      setSettings((prev) =>
        prev.modelName === bootModel ? prev : { ...prev, modelName: bootModel },
      );
      setModel(bootModel);
    });
  }, [isSplashMode]);

  const updateSession = useCallback(
    (chatId: string, updater: (session: ChatSession) => ChatSession) => {
      let changed: ChatSession | null = null;

      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.id === chatId);
        if (idx === -1) return prev;

        const updated = updater(prev[idx]);
        if (updated === prev[idx]) return prev;

        const next = prev.slice();
        next[idx] = updated;
        changed = updated;
        return next;
      });

      if (changed) persistSession(changed);
    },
    [persistSession],
  );

  const patchActiveMessage = useCallback(
    (
      chatId: string,
      patch: Partial<MessageVersion>,
      sessionPatch?: Partial<ChatSession>,
    ) => {
      updateSession(chatId, (s) => {
        if (s.messages.length === 0) {
          return sessionPatch ? { ...s, ...sessionPatch } : s;
        }

        const msgs = s.messages.slice();
        const lastIdx = msgs.length - 1;
        const last = msgs[lastIdx];
        const vIdx = last.currentVersionIndex;

        if (last.versions && vIdx !== undefined && vIdx < last.versions.length) {
          const versions = last.versions.slice();
          versions[vIdx] = { ...versions[vIdx], ...patch };
          msgs[lastIdx] = { ...last, versions };
        } else {
          msgs[lastIdx] = { ...last, ...patch };
        }

        return { ...s, messages: msgs, ...sessionPatch };
      });
    },
    [updateSession],
  );

  const toolEnvironment = useCallback(
    (current: AppSettings): ToolEnvironment => ({
      webMode: current.webMode,
      codeExecution: current.codeExecution && Boolean(window.electronAPI?.runner),
      libraryReady: libraryReady && current.libraryEnabled,
    }),
    [libraryReady],
  );

  const generateResponse = useCallback(
    async (
      chatId: string,
      contextMessages: Message[],
      isRetry = false,
      isContinuation = false,
    ) => {
      if (!model) return;

      abortControllers.current[chatId]?.abort();
      const controller = new AbortController();
      abortControllers.current[chatId] = controller;

      updateSession(chatId, (s) => {
        let msgs: Message[];

        if (isContinuation) {
          msgs = [...contextMessages];
        } else if (isRetry) {
          msgs = [...s.messages];
          const lastIdx = msgs.length - 1;
          const lastMsg = { ...msgs[lastIdx] };

          if (lastMsg.role === "assistant") {
            const oldVersion: MessageVersion = {
              content: lastMsg.content,
              thinkingContent: lastMsg.thinkingContent,
              textContent: lastMsg.textContent,
              thoughtTime: lastMsg.thoughtTime,
              steps: lastMsg.steps,
              metrics: lastMsg.metrics,
            };
            lastMsg.versions = [...(lastMsg.versions || []), oldVersion];
            lastMsg.currentVersionIndex = lastMsg.versions.length;
            lastMsg.content = "";
            lastMsg.thinkingContent = null;
            lastMsg.textContent = "";
            lastMsg.thoughtTime = undefined;
            lastMsg.steps = [];
            lastMsg.metrics = null;
            msgs[lastIdx] = lastMsg;
          }
        } else {
          msgs = [
            ...contextMessages,
            {
              id: generateId(),
              role: "assistant" as const,
              content: "",
              steps: [],
            },
          ];
        }

        return { ...s, isGenerating: true, messages: msgs };
      });

      let seed = null;
      if (isContinuation) {
        const lastMsg = contextMessages[contextMessages.length - 1];
        if (lastMsg && lastMsg.role === "assistant") {
          const target =
            lastMsg.versions &&
            lastMsg.currentVersionIndex !== undefined &&
            lastMsg.currentVersionIndex < lastMsg.versions.length
              ? lastMsg.versions[lastMsg.currentVersionIndex]
              : lastMsg;

          seed = {
            content: target.content || "",
            textContent: target.textContent || "",
            steps: target.steps ? [...target.steps] : [],
          };
        }
      }

      try {
        const result = await runAgentTurn(
          {
            model,
            settings: settingsRef.current,
            environment: toolEnvironment(settingsRef.current),
            messages: contextMessages,
            isContinuation,
            seed,
            signal: controller.signal,
          },
          {
            t,
            onSteps: (steps: SearchStep[]) =>
              patchActiveMessage(chatId, { steps }),
            onPatch: (patch) =>
              patchActiveMessage(
                chatId,
                {
                  content: patch.content,
                  textContent: patch.textContent,
                  steps: patch.steps,
                },
                { updatedAt: Date.now() },
              ),
            onOutOfContext: (outOfContext: boolean) =>
              updateSession(chatId, (s) =>
                s.isOutOfContext === outOfContext
                  ? s
                  : { ...s, isOutOfContext: outOfContext },
              ),
            onMetrics: (metrics: TurnMetrics | null) =>
              patchActiveMessage(chatId, { metrics }),
          },
        );

        if (result.exhausted) {
          patchActiveMessage(
            chatId,
            { steps: result.steps, textContent: result.textContent },
            { updatedAt: Date.now(), isOutOfContext: result.outOfContext },
          );
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          updateSession(chatId, (s) => ({
            ...s,
            messages: [
              ...s.messages.slice(0, -1),
              {
                id: generateId(),
                role: "assistant",
                content: err.message || "Error generating response.",
              },
            ],
          }));
        }
      } finally {
        if (abortControllers.current[chatId] === controller) {
          delete abortControllers.current[chatId];
          updateSession(chatId, (s) =>
            s.isGenerating ? { ...s, isGenerating: false } : s,
          );
        }
      }
    },
    [model, updateSession, patchActiveMessage, toolEnvironment, t],
  );

  const handleStopGeneration = useCallback(
    (chatId: string) => {
      if (abortControllers.current[chatId]) {
        abortControllers.current[chatId].abort();
        delete abortControllers.current[chatId];
      }
      updateSession(chatId, (s) => ({ ...s, isGenerating: false }));
    },
    [updateSession],
  );

  const handleRegenerate = useCallback(
    (chatId: string, index?: number) => {
      const session = sessionsRef.current.find((s) => s.id === chatId);
      if (!session) return;

      const targetMessages =
        typeof index === "number" && index >= 0
          ? session.messages.slice(0, index)
          : session.messages.slice(0, -1);

      generateResponse(chatId, targetMessages, true);
    },
    [generateResponse],
  );

  const handleEditMessage = useCallback(
    (chatId: string, messageIndex: number, newContent: string) => {
      const session = sessionsRef.current.find((s) => s.id === chatId);
      if (!session) return;

      const targetMsg = session.messages[messageIndex];
      if (!targetMsg || targetMsg.role !== "user") return;

      const versions: MessageVersion[] = [
        ...(targetMsg.versions || []),
        { content: targetMsg.content },
      ];

      const msgs = session.messages.slice(0, messageIndex);
      msgs.push({
        ...targetMsg,
        content: newContent,
        versions,
        currentVersionIndex: versions.length,
      });

      updateSession(chatId, (s) => ({ ...s, messages: msgs }));
      generateResponse(chatId, msgs, false);
    },
    [generateResponse, updateSession],
  );

  const handleSwitchVersion = useCallback(
    (chatId: string, messageIndex: number, versionIndex: number) => {
      updateSession(chatId, (s) => {
        const msgs = [...s.messages];
        if (msgs[messageIndex]) {
          msgs[messageIndex] = {
            ...msgs[messageIndex],
            currentVersionIndex: versionIndex,
          };
        }
        return { ...s, messages: msgs };
      });
    },
    [updateSession],
  );

  const handleSendMessage = useCallback(
    (chatId: string, content: string, attachments?: Attachment[]) => {
      const existing = sessionsRef.current.find((s) => s.id === chatId);
      const userMessage: Message = {
        id: generateId(),
        role: "user",
        content,
        attachments,
      };

      if (!existing) {
        const session: ChatSession = {
          id: chatId,
          title: content.trim()
            ? titleFromContent(content, t("newDiscussion"))
            : attachments && attachments.length > 0
              ? t("attachedFiles")
              : t("newDiscussion"),
          messages: [],
          updatedAt: Date.now(),
          isGenerating: false,
        };

        setSessions((prev) =>
          prev.some((s) => s.id === chatId) ? prev : [session, ...prev],
        );
      }

      generateResponse(chatId, [...(existing?.messages || []), userMessage]);
    },
    [generateResponse, t],
  );

  const handleDismissOutOfContext = useCallback(
    (chatId: string) => {
      updateSession(chatId, (s) => ({ ...s, isOutOfContext: false }));
    },
    [updateSession],
  );

  const handleContinueGeneration = useCallback(
    (chatId: string) => {
      const session = sessionsRef.current.find((s) => s.id === chatId);
      if (!session) return;
      handleDismissOutOfContext(chatId);
      generateResponse(chatId, session.messages, false, true);
    },
    [generateResponse, handleDismissOutOfContext],
  );

  const handleDeleteChat = useCallback(
    (e: React.MouseEvent, chatId: string) => {
      e.stopPropagation();
      handleStopGeneration(chatId);
      cancelSessionSave(chatId);
      setSessions((prev) => prev.filter((s) => s.id !== chatId));
      storageBackend()
        .deleteSession(chatId)
        .catch(() => undefined);
      if (currentChatId === chatId) setCurrentChatId(null);
    },
    [currentChatId, handleStopGeneration],
  );

  const handleNewChat = useCallback(() => {
    const id = generateId();
    setCurrentChatId(id);
    setViewMode("chat");
  }, []);

  const selectChat = useCallback((id: string) => {
    setCurrentChatId(id);
    setViewMode("chat");
  }, []);

  const handleClearChats = useCallback(() => {
    Object.values(abortControllers.current).forEach((c) => c.abort());
    abortControllers.current = {};
    for (const session of sessionsRef.current) cancelSessionSave(session.id);
    setSessions([]);
    setCurrentChatId(null);
    storageBackend()
      .clearSessions()
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!model || currentChatId || !hydrated) return;

    const restored = sessions[0];
    setCurrentChatId(restored ? restored.id : generateId());
  }, [model, currentChatId, hydrated, sessions]);

  const handleSplashReady = useCallback((selectedModel: string) => {
    window.electronAPI?.bootFinished(selectedModel);
  }, []);

  const handleModelReady = useCallback((selectedModel: string) => {
    setModel(selectedModel);
    setSettings((prev) =>
      prev.modelName === selectedModel
        ? prev
        : { ...prev, modelName: selectedModel },
    );
    // Loading the weights takes seconds, and paying for that inside the
    // first message is the moment it feels worst. Starting it here — at boot
    // and on every model switch, while the user is still reading or typing —
    // means it is usually already resident by the time they send.
    if (!isCloudModel(selectedModel)) {
      warmModel(selectedModel, KEEP_ALIVE).catch(() => undefined);
    }
  }, []);

  // Stable identities so MessageItem's memo() actually skips messages that
  // have not changed instead of re-rendering the whole conversation on every
  // streamed token — a plain inline arrow function here would hand every
  // message a "new" callback prop on every render.
  const onRegenerateChat = useCallback(
    (idx: number) => {
      if (currentChatId) handleRegenerate(currentChatId, idx);
    },
    [currentChatId, handleRegenerate],
  );
  const onSwitchVersionChat = useCallback(
    (mIdx: number, vIdx: number) => {
      if (currentChatId) handleSwitchVersion(currentChatId, mIdx, vIdx);
    },
    [currentChatId, handleSwitchVersion],
  );
  const onEditMessageChat = useCallback(
    (mIdx: number, content: string) => {
      if (currentChatId) handleEditMessage(currentChatId, mIdx, content);
    },
    [currentChatId, handleEditMessage],
  );

  const currentSession = sessions.find((s) => s.id === currentChatId);

  if (isSplashMode) {
    return (
      <div
        className="w-screen h-screen overflow-hidden flex"
        style={{ backgroundColor: "#1e1e1e" }}
      >
        <StartupScreen
          modelName={settings.modelName}
          language={settings.language}
          onReady={handleSplashReady}
        />
      </div>
    );
  }

  if (!model) {
    return (
      <div
        className="w-screen h-screen overflow-hidden flex"
        style={{ backgroundColor: "var(--bg-base)", color: "var(--text-main)" }}
      >
        <StartupScreen
          modelName={settings.modelName}
          language={settings.language}
          onReady={handleModelReady}
        />
      </div>
    );
  }

  return (
    <div
      className="w-screen h-screen overflow-hidden flex transition-colors duration-300"
      style={{ backgroundColor: "var(--bg-base)", color: "var(--text-main)" }}
    >
      {storageWarning && (
        <div
          role="alert"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 px-4 py-3 rounded-xl border-[3px] border-red-500 bg-[var(--bg-panel)] shadow-lg"
        >
          <span className="text-xs font-bold text-red-500">{storageWarning}</span>
          <button
            onClick={() => setStorageWarning(null)}
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
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0 relative">
        {viewMode === "history" ? (
          <ChatHistory
            sessions={sessions}
            onSelectChat={selectChat}
            onDeleteChat={handleDeleteChat}
            settings={settings}
          />
        ) : viewMode === "files" ? (
          <CreatedFiles settings={settings} />
        ) : viewMode === "talk" ? (
          <TalkScreen settings={settings} />
        ) : viewMode === "settings" ? (
          <SettingsPage
            settings={settings}
            activeModel={model}
            initialTab={settingsTab}
            onUpdate={setSettings}
            onSelectModel={handleModelReady}
            onClearChats={handleClearChats}
            onLibraryChange={refreshLibraryReadiness}
          />
        ) : currentChatId ? (
          <ChatScreen
            model={model}
            chat={
              currentSession || {
                id: currentChatId,
                title: "New Chat",
                messages: [],
                updatedAt: Date.now(),
                isGenerating: false,
              }
            }
            onSendMessage={(content, attachments) =>
              handleSendMessage(currentChatId, content, attachments)
            }
            onRegenerate={onRegenerateChat}
            onSwitchVersion={onSwitchVersionChat}
            onEditMessage={onEditMessageChat}
            onStopGeneration={() => handleStopGeneration(currentChatId)}
            onContinueGeneration={() => handleContinueGeneration(currentChatId)}
            onDismissOutOfContext={() => handleDismissOutOfContext(currentChatId)}
            onSelectModel={handleModelReady}
            onOpenSettings={openSettings}
            onNewChat={handleNewChat}
            settings={settings}
            onUpdateSettings={setSettings}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center bg-[var(--bg-base)]" />
        )}
      </div>
    </div>
  );
}
