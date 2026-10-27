import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-async";
import { Transcript } from "./chat/Transcript";
import { QuestionCard } from "./chat/components/QuestionCard";
import { QuestionSessionContext } from "./chat/questionSessionContext";
import { questionSessionStore } from "./store/questionSession";
import { processQuestionsFromText } from "./chat/questionParser";
import type { QuestionSession } from "./chat/questionTypes";
import { Composer, type WorkContext } from "./chat/Composer";
import { useChatSession } from "./chat/useChatSession";
import { useToollessPlan } from "./chat/useToollessPlan";
import { pickGreeting } from "./greetings";
import TypedGreeting from "./TypedGreeting";
import { copyText } from "./utils";
import { translations } from "./translations";
import { Icon } from "./ui";
import type { SettingsTab } from "./settings/pages";
import type { ContextMeasurement } from "./agent/agentLoop";
import type { CompactOutcome } from "./agent/taskManager";
import type {
  AppSettings,
  ApprovalAnswer,
  Attachment,
  ChatSession,
  InstalledSkill,
  PermissionMode,
} from "./types";

const NO_SKILLS: InstalledSkill[] = [];

interface ChatScreenProps {
  model: string;
  chat: ChatSession;
  onSendMessage: (content: string, attachments?: Attachment[]) => void;
  onRegenerate: (index: number) => void;
  onSwitchVersion: (messageIndex: number, versionIndex: number) => void;
  onEditMessage: (messageIndex: number, newContent: string) => void;
  onStopGeneration: () => void;
  onContinueGeneration: () => void;
  onSelectModel: (name: string) => void;
  onOpenSettings: (tab: SettingsTab) => void;
  onNewChat: () => void;
  surface: "chat" | "code";
  skills?: InstalledSkill[];
  settings: AppSettings;
  onPatchSettings: (patch: Partial<AppSettings>) => void;
  permissionMode?: PermissionMode;
  workContext?: WorkContext;
  onPermissionMode?: (mode: PermissionMode) => void;
  onApproval?: (approvalId: string, answer: ApprovalAnswer) => void;
  onRevert?: (checkpointId: number) => Promise<boolean>;
  onProjectMemory?: () => void;
  onInitProject?: () => void;
  onCompact?: () => Promise<CompactOutcome>;
  /** "/image <prompt>", drawn by the image engine with no model turn in between. */
  onImageCommand?: (argument: string, attachments: Attachment[]) => void;
  onOpenUsage?: () => void;
  unavailable?: string;
  seedDraft?: string;
  onSeedUsed?: () => void;
  onMeasureContext?: (
    draft: string,
    attachments: Attachment[],
    options: { signal: AbortSignal; allowLoad: boolean },
  ) => Promise<ContextMeasurement | null>;
}

/* Chat view coordinating the message transcript, bottom prompt composer and drag drops. */
export default function ChatScreen({
  model,
  chat,
  onSendMessage,
  onRegenerate,
  onSwitchVersion,
  onEditMessage,
  onStopGeneration,
  onContinueGeneration,
  onSelectModel,
  onOpenSettings,
  onNewChat,
  surface,
  skills = NO_SKILLS,
  settings,
  onPatchSettings,
  permissionMode,
  onPermissionMode,
  onApproval,
  onRevert,
  onProjectMemory,
  onInitProject,
  onCompact,
  onImageCommand,
  onOpenUsage,
  onMeasureContext,
  unavailable,
  seedDraft,
  onSeedUsed,
  workContext,
}: ChatScreenProps) {
  const t = useCallback(
    (key: string) =>
      translations[settings.language]?.[key] || translations["en"][key] || key,
    [settings.language],
  );

  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarWidth, setToolbarWidth] = useState(Infinity);

  const session = useChatSession({
    model,
    chat,
    surface,
    settings,
    skills,
    seedDraft,
    onSeedUsed,
    onNewChat,
    onOpenSettings,
    onPatchSettings,
    onMeasureContext,
    onCompact,
    onProjectMemory,
    onInitProject,
    t,
  });

  useToollessPlan({
    active: surface === "code",
    toolsUnavailable: session.toolsUnavailable,
    permissionMode,
    onPermissionMode,
  });

  useEffect(() => {
    const preload = (
      SyntaxHighlighter as unknown as { preload?: () => Promise<unknown> }
    ).preload;
    if (!preload) return;
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(() => preload());
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(preload, 2000);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setToolbarWidth(Math.round(entry.contentRect.width)));
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, []);

  const compactToolbar = toolbarWidth < 640;
  const tightToolbar = toolbarWidth < 420;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    // Crossing into a child fires dragleave too; only leaving the screen drops the outline.
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      await session.processFiles(Array.from(files));
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    let hasFiles = false;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === "file") {
        const file = items[i].getAsFile();
        if (file) {
          files.push(file);
          hasFiles = true;
        }
      }
    }
    if (hasFiles) {
      e.preventDefault();
      await session.processFiles(files);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (chat.isGenerating) onStopGeneration();
        return;
      }
      if (!event.ctrlKey && !event.metaKey) return;
      const key = event.key.toLowerCase();
      if (key === "n") {
        event.preventDefault();
        onNewChat();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [chat.isGenerating, onStopGeneration, onNewChat]);

  const copyToClipboard = useCallback(async (text: string, idx: number) => {
    if (!(await copyText(text))) return;
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 2000);
  }, []);

  const greeting = useMemo(
    () => pickGreeting(settings.language, chat.id),
    [settings.language, chat.id],
  );

  const [activeQuestionSession, setActiveQuestionSession] = useState<QuestionSession | null>(null);
  const [allQuestionSessions, setAllQuestionSessions] = useState<QuestionSession[]>([]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const list = await questionSessionStore.getAllSessions(chat.id);
      if (!mounted) return;
      setAllQuestionSessions(list);
      const active = list.find((s) => s.status === "active") ?? null;
      setActiveQuestionSession(active);
    };

    load();
    const unsub = questionSessionStore.subscribe((s) => {
      if (s.chatId === chat.id && mounted) {
        load();
      }
    });
    return () => {
      mounted = false;
      unsub();
    };
  }, [chat.id]);

  useEffect(() => {
    if (settings.aiQuestionsEnabled === false || chat.aiQuestionsDisabled) return;
    const lastMsg = chat.messages[chat.messages.length - 1];
    if (lastMsg && lastMsg.role === "assistant") {
      const rawText = lastMsg.textContent ?? lastMsg.content ?? "";
      if (rawText.includes('"_draggy"')) {
        processQuestionsFromText(rawText, chat.id, chat.workspaceId, lastMsg.id);
      }
    }
  }, [chat.messages, chat.id, chat.workspaceId, settings.aiQuestionsEnabled, chat.aiQuestionsDisabled]);

  useEffect(() => {
    if (!settings.aiQuestionsAutoSkip || !settings.aiQuestionsTimeoutMinutes || !activeQuestionSession) return;
    const timeoutMs = settings.aiQuestionsTimeoutMinutes * 60 * 1000;
    const elapsed = Date.now() - activeQuestionSession.startedAt;
    const remaining = Math.max(0, timeoutMs - elapsed);

    const timer = setTimeout(() => {
      questionSessionStore.expireSession(activeQuestionSession.id);
    }, remaining);

    return () => clearTimeout(timer);
  }, [activeQuestionSession, settings.aiQuestionsAutoSkip, settings.aiQuestionsTimeoutMinutes]);

  const handleAnswerQuestion = useCallback(
    async (questionId: string, value: string | string[]) => {
      if (!activeQuestionSession) return;
      const q = activeQuestionSession.questions.find((item) => item.id === questionId);
      if (!q) return;
      await questionSessionStore.submitAnswer(activeQuestionSession.id, {
        questionId,
        type: q.type,
        value,
        submittedAt: Date.now(),
      });
    },
    [activeQuestionSession],
  );

  const handleSkipQuestion = useCallback(
    async (questionId: string) => {
      if (!activeQuestionSession) return;
      await questionSessionStore.skipQuestion(activeQuestionSession.id, questionId);
    },
    [activeQuestionSession],
  );

  const handleNavigateQuestion = useCallback(
    async (index: number) => {
      if (!activeQuestionSession) return;
      await questionSessionStore.setCurrentIndex(activeQuestionSession.id, index);
    },
    [activeQuestionSession],
  );

  const handleCompleteQuestionSession = useCallback(async () => {
    if (!activeQuestionSession) return;
    const completed = await questionSessionStore.completeSession(activeQuestionSession.id);
    if (completed.answers.length > 0) {
      const summaryLines = completed.questions
        .map((q) => {
          const ans = completed.answers.find((a) => a.questionId === q.id);
          if (!ans) return null;
          let valStr = "";
          if (Array.isArray(ans.value)) {
            valStr = ans.value
              .map((id) => q.options?.find((o) => o.id === id)?.label || id)
              .join(", ");
          } else {
            valStr = q.options?.find((o) => o.id === ans.value)?.label || ans.value;
          }
          return `${q.text}: ${valStr}`;
        })
        .filter(Boolean);

      if (summaryLines.length > 0) {
        onSendMessage(summaryLines.join("\n"));
      }
    }
  }, [activeQuestionSession, onSendMessage]);

  const isHome = chat.messages.length === 0;

  const questionContextValue = useMemo(
    () => ({
      sessions: allQuestionSessions,
      activeSession: activeQuestionSession,
      onAnswer: handleAnswerQuestion,
      onSkip: handleSkipQuestion,
      onNavigate: handleNavigateQuestion,
      onComplete: handleCompleteQuestionSession,
      t,
    }),
    [
      allQuestionSessions,
      activeQuestionSession,
      handleAnswerQuestion,
      handleSkipQuestion,
      handleNavigateQuestion,
      handleCompleteQuestionSession,
      t,
    ],
  );

  const lastMsg = chat.messages[chat.messages.length - 1];
  const lastMsgHasQuestion =
    lastMsg &&
    lastMsg.role === "assistant" &&
    (lastMsg.textContent ?? lastMsg.content ?? "").includes('"_draggy"');

  const composer = (
    <Composer
      variant={isHome ? "home" : "dock"}
      model={model}
      chat={chat}
      surface={surface}
      settings={settings}
      unavailable={unavailable}
      input={session.input}
      setInput={session.setInput}
      attachedFiles={session.attachedFiles}
      fileErrors={session.fileErrors}
      notice={session.notice}
      micState={session.micState}
      micAnalyser={session.micAnalyser}
      micDetail={session.micDetail}
      slashMatches={session.slashMatches}
      activeSlashIndex={session.activeSlashIndex}
      modelInfo={session.modelInfo}
      modelProvider={session.modelProvider}
      thinkingUnavailable={session.thinkingUnavailable}
      toolsUnavailable={session.toolsUnavailable}
      permissionMode={permissionMode}
      contextView={session.contextView}
      compacting={session.compacting}
      acceptAttribute={session.acceptAttribute}
      compactToolbar={compactToolbar}
      tightToolbar={tightToolbar}
      speechSupported={session.speechSupported}
      t={t}
      onSendMessage={onSendMessage}
      onStopGeneration={onStopGeneration}
      onSelectModel={onSelectModel}
      onOpenSettings={onOpenSettings}
      onPatchSettings={onPatchSettings}
      onPermissionMode={onPermissionMode}
      workContext={workContext}
      onCompact={onCompact}
      onImageCommand={onImageCommand}
      clearAttachments={session.clearAttachments}
      onOpenUsage={onOpenUsage}
      onProjectMemory={onProjectMemory}
      removeFile={session.removeFile}
      handleMicClick={session.handleMicClick}
      runSlashCommand={session.runSlashCommand}
      setSlashIndex={session.setSlashIndex}
      setCaret={session.setCaret}
      chipRanges={session.chipRanges}
      onPaste={handlePaste}
      onDrop={handleDrop}
      processFiles={session.processFiles}
      setCompactLimit={session.setCompactLimit}
    />
  );

  return (
    <div
      ref={toolbarRef}
      className="w-full h-full flex flex-col bg-surface-canvas relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-3 z-50 rounded-lg border border-dashed border-rule-strong bg-surface-base/80 flex items-center justify-center pointer-events-none"
          >
            <div className="flex flex-col items-center gap-2 text-text-secondary">
              <Icon name="file-arrow-up" size={24} />
              <p className="text-[15px] font-medium text-text-primary">{t("dropFiles")}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isHome ? (
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center px-4 pb-[10vh]">
          <h1 className="max-w-[720px] mb-6 text-center display-line text-[32px] leading-10 font-semibold tracking-[-0.01em] text-text-primary text-balance">
            <TypedGreeting key={greeting} text={greeting} />
          </h1>
          {composer}
        </div>
      ) : (
        <>
          <QuestionSessionContext.Provider value={questionContextValue}>
            <Transcript
              chat={chat}
              copiedIndex={copiedIndex}
              settings={settings}
              onRegenerate={onRegenerate}
              onResume={onContinueGeneration}
              onSwitchVersion={onSwitchVersion}
              onEditMessage={onEditMessage}
              onApproval={onApproval}
              onRevert={onRevert}
              copyToClipboard={copyToClipboard}
              t={t}
            />
          </QuestionSessionContext.Provider>
          {activeQuestionSession && !lastMsgHasQuestion && (
            <QuestionCard
              session={activeQuestionSession}
              onAnswer={handleAnswerQuestion}
              onSkip={handleSkipQuestion}
              onNavigate={handleNavigateQuestion}
              onComplete={handleCompleteQuestionSession}
              t={t}
            />
          )}
          {composer}
        </>
      )}
    </div>
  );
}
