import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-async";
import { Transcript } from "./chat/Transcript";
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
  onDismissOutOfContext: () => void;
  onSelectModel: (name: string) => void;
  onOpenSettings: (tab: SettingsTab) => void;
  onNewChat: () => void;
  onTalk?: () => void;
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
  onDismissOutOfContext,
  onSelectModel,
  onOpenSettings,
  onNewChat,
  onTalk,
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

  const isHome = chat.messages.length === 0;

  const composer = (
    <Composer
      variant={isHome ? "home" : "dock"}
      model={model}
      chat={chat}
      surface={surface}
      settings={settings}
      skills={skills}
      unavailable={unavailable}
      input={session.input}
      setInput={session.setInput}
      attachedFiles={session.attachedFiles}
      fileErrors={session.fileErrors}
      notice={session.notice}
      micState={session.micState}
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
      onContinueGeneration={onContinueGeneration}
      onDismissOutOfContext={onDismissOutOfContext}
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
          {onTalk && (
            <button
              type="button"
              onClick={onTalk}
              className="mt-4 h-8 px-3.5 inline-flex items-center gap-2 rounded-pill border border-rule text-[13px] font-medium text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors duration-120 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
            >
              <Icon name="waveform" size={16} />
              {t("talkInstead")}
            </button>
          )}
        </div>
      ) : (
        <>
          <Transcript
            chat={chat}
            copiedIndex={copiedIndex}
            settings={settings}
            onRegenerate={onRegenerate}
            onSwitchVersion={onSwitchVersion}
            onEditMessage={onEditMessage}
            onApproval={onApproval}
            onRevert={onRevert}
            copyToClipboard={copyToClipboard}
            t={t}
          />
          {composer}
        </>
      )}
    </div>
  );
}
