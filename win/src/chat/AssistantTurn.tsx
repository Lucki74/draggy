import { useContext, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import StreamingMarkdown from "./StreamingMarkdown";
import { copyAsMarkdown } from "./copyMarkdown";
import BrowserConsentCard from "./BrowserConsentCard";
import ThinkingRow from "./ThinkingRow";
import { showsTailMark } from "./indicator";
import WorkingStatus from "./WorkingStatus";
import WorkBlock from "./WorkBlock";
import WorkGroup from "./WorkGroup";
import { isWorkStep, touchedFiles } from "./workSummary";
import { OpenFileContext } from "./openFileContext";
import { useTranscriptView } from "./transcriptView";
import TurnActions from "./TurnActions";
import { Button, Chip, Icon, Lightbox, Spark } from "../ui";
import { formatTokenCount } from "../agent/contextBreakdown";
import { normalizeMath, sanitizeContent } from "../utils";
import { continuesBody } from "./continuation";
import { parseQuestions } from "./questionParser";
import { useQuestionSessionContext } from "./questionSessionContext";
import { QuestionCard } from "./components/QuestionCard";
import { QuestionHistoryCard } from "./components/QuestionHistoryCard";
import {
  MARKDOWN_COMPONENTS,
  REHYPE_PLUGINS,
  REMARK_PLUGINS,
} from "./markdown";
import type {
  AppSettings,
  ApprovalAnswer,
  Attachment,
  FoldMarker,
  Message,
  MessageVersion,
  SearchStep,
  TurnErrorKind,
} from "../types";

// Friendly line per failure kind; unknown failures show only the raw error.
const ERROR_KIND_KEYS: Record<Exclude<TurnErrorKind, "unknown">, string> = {
  engine: "errorKindEngine",
  memory: "errorKindMemory",
  network: "errorKindNetwork",
  "rate-limit": "errorKindRateLimit",
  context: "errorKindContext",
};

// Summarizes compacted history tokens so the user knows where earlier context was saved.
export function FoldLine({
  fold,
  t,
}: {
  fold: FoldMarker;
  t: (key: string) => string;
}) {
  const running = fold.status === "running";

  return (
    <div role="status" className="flex items-center gap-3 mt-4 mb-1">
      <div className="h-px flex-1 bg-rule" />
      <span className="flex items-center gap-1.5 text-[12px] whitespace-nowrap text-text-secondary">
        {running ? <Spark /> : <Icon name="arrows-in-simple" size={14} />}
        {running
          ? t("compactingConversation")
          : t("compactedTokens").replace(
              "{count}",
              formatTokenCount(fold.tokens),
            )}
      </span>
      <div className="h-px flex-1 bg-rule" />
    </div>
  );
}

export interface AssistantTurnProps {
  msg: Message;
  displayMsg: Message | MessageVersion;
  idx: number;
  text: string;
  steps: SearchStep[];
  live: boolean;
  isGenerating: boolean;
  isLast: boolean;
  onRegenerate: (index: number) => void;
  onResume?: () => void;
  onSwitchVersion: (messageIndex: number, versionIndex: number) => void;
  copiedIndex: number | null;
  copyToClipboard: (text: string, idx: number) => void;
  settings: AppSettings;
  onApproval?: (approvalId: string, answer: ApprovalAnswer) => void;
  onRevert?: (checkpointId: number) => Promise<boolean>;
  chatId?: string;
  totalVersions: number;
  currentVersionIndex: number;
  currentVersionNum: number;
  t: (key: string) => string;
}

// Assistant reply containing thoughts, tool steps, streamed markdown, actions and fold status.
export function AssistantTurn({
  msg,
  displayMsg,
  idx,
  text,
  steps,
  live,
  isGenerating,
  isLast,
  onRegenerate,
  onResume,
  onSwitchVersion,
  copiedIndex,
  copyToClipboard,
  settings,
  onApproval,
  onRevert,
  chatId,
  totalVersions,
  currentVersionIndex,
  currentVersionNum,
  t,
}: AssistantTurnProps) {
  const [previewFile, setPreviewFile] = useState<Attachment | null>(null);
  const isFailed = Boolean(displayMsg.failed) && !isGenerating;
  const errorMessage = displayMsg.error || (isFailed ? text : "");
  // Content keeps only model text on failure; the error sits in `error`.
  const hasGeneratedText = isFailed
    ? Boolean(text.trim()) && text.trim() !== errorMessage.trim()
    : Boolean(text.trim());
  const friendlyError =
    isFailed && displayMsg.errorKind && displayMsg.errorKind !== "unknown"
      ? t(ERROR_KIND_KEYS[displayMsg.errorKind])
      : null;
  const view = useTranscriptView();
  const questionCtx = useQuestionSessionContext();

  const matchingSession = useMemo(() => {
    if (!questionCtx) return null;
    const parsed = parseQuestions(text);
    if (!parsed.hasQuestions && !text.includes('"_draggy"')) return null;

    // 1. Match by messageId
    let match = questionCtx.sessions.find((s) => s.messageId === msg.id);
    if (match) return match;

    // 2. Match by sessionId
    if (parsed.sessionId) {
      match = questionCtx.sessions.find(
        (s) => s.id === parsed.sessionId || s.metadata?.parsedSessionId === parsed.sessionId,
      );
      if (match) return match;
    }

    // 3. Match by question IDs
    if (parsed.questions.length > 0) {
      match = questionCtx.sessions.find((s) =>
        s.questions.some((q) => parsed.questions.some((pq) => pq.id === q.id)),
      );
      if (match) return match;
    }

    // 4. Fallback for active session on last turn
    if (isLast && questionCtx.activeSession && parsed.hasQuestions) {
      return questionCtx.activeSession;
    }

    return null;
  }, [questionCtx, msg.id, text, isLast]);
  // Changes put back this session, leaving message text as the historical record.
  const [reverted, setReverted] = useState<ReadonlySet<number>>(new Set());
  // In a project the file opens in the canvas; elsewhere it lives in the output folder.
  const openInCanvas = useContext(OpenFileContext);
  const openTouched = (path: string) =>
    openInCanvas ? openInCanvas(path) : window.electronAPI?.openFile?.(path);

  const revert = async (checkpointId: number) => {
    if (!onRevert || reverted.has(checkpointId)) return;
    const undone = await onRevert(checkpointId);
    if (undone) setReverted((prev) => new Set(prev).add(checkpointId));
  };

  // Prose being written stays in the timeline until complete, then becomes reply body.
  const lastStep = steps[steps.length - 1];
  const writingId =
    live && lastStep?.type === "text" && !lastStep.isComplete
      ? lastStep.id
      : null;
  // A continued reply streams as one block in the timeline, so the old body would show twice.
  const bodyInStep = Boolean(writingId) && continuesBody(text, lastStep?.content ?? "");
  const [proseId, setProseId] = useState<string | null>(null);
  if (writingId && writingId !== proseId) setProseId(writingId);
  const bodyKey =
    proseId && !steps.some((step) => step.id === proseId)
      ? `prose-${proseId}`
      : "prose-body";

  const renderStep = (step: SearchStep) => {
    // Prose the model wrote before a tool call, rendered exactly like reply body.
    if (step.type === "text") {
      if (!step.content.trim()) return null;

      return (
        <div key={`prose-${step.id}`} className="mb-4">
          {live ? (
            <StreamingMarkdown
              source={normalizeMath(sanitizeContent(step.content))}
              streaming={isGenerating && !step.isComplete}
              animateOnMount={isGenerating && !step.isComplete}
              components={MARKDOWN_COMPONENTS}
            />
          ) : (
            <ReactMarkdown
              remarkPlugins={REMARK_PLUGINS}
              rehypePlugins={REHYPE_PLUGINS}
              components={MARKDOWN_COMPONENTS}
            >
              {normalizeMath(sanitizeContent(step.content))}
            </ReactMarkdown>
          )}
        </div>
      );
    }

    if (step.type === "thinking") {
      return (
        <ThinkingRow
          key={step.id}
          step={step}
          live={live}
          isGenerating={isGenerating}
          t={t}
        />
      );
    }

    // A note the user added mid-reply, shown where it was added.
    if (step.type === "steer") {
      return (
        <div key={step.id} className="flex items-start gap-2 mb-3 text-[14px] text-text-secondary">
          <Icon name="user" size={14} className="mt-1 flex-shrink-0" />
          <span className="min-w-0 whitespace-pre-wrap wrap-anywhere">
            <span className="text-text-tertiary me-1.5">{t("steerNote")}</span>
            {step.content}
          </span>
        </div>
      );
    }

    return (
      <WorkBlock
        key={step.id}
        step={step}
        live={live}
        isGenerating={isGenerating}
        isLast={isLast}
        onApproval={onApproval}
        onRevert={revert}
        isReverted={
          step.checkpointId !== undefined
            ? reverted.has(step.checkpointId)
            : false
        }
        t={t}
      />
    );
  };

  const files = touchedFiles(steps);

  // Steps that draw nothing never split a group. Finished thinking draws nothing in the normal view.
  const invisible = (step: SearchStep) =>
    (step.type === "text" && !step.content.trim()) ||
    (step.type === "thinking" &&
      (!step.content || (step.isComplete && view === "normal")));

  // Consecutive tool steps fold into one work block; prose, reasoning, notes and questions stand alone.
  const isWork = (step: SearchStep) => isWorkStep(step) && step.type !== "steer";
  const segments: SearchStep[][] = [];
  for (const step of steps) {
    if (invisible(step)) continue;
    const last = segments[segments.length - 1];
    if (isWork(step) && last && isWork(last[0])) last.push(step);
    else segments.push([step]);
  }

  return (
    <>
      {msg.attachments && msg.attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {msg.attachments.map((file, fIdx) =>
            file.type.startsWith("image/") ? (
              <button
                key={fIdx}
                type="button"
                onClick={() => setPreviewFile(file)}
                title={file.name}
                className="rounded-sm overflow-hidden border border-rule hover:border-rule-strong cursor-pointer"
              >
                <img
                  src={file.content}
                  alt={file.name}
                  className="block w-32 h-32 object-cover"
                />
              </button>
            ) : (
              <span
                key={fIdx}
                title={file.name}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-pill border border-rule text-[13px] text-text-secondary"
              >
                <Icon
                  name={
                    file.type.startsWith("video/") ? "film-strip" : "file-text"
                  }
                  size={14}
                />
                <span className="truncate max-w-[180px] text-text-primary">
                  {file.name}
                </span>
              </span>
            ),
          )}
        </div>
      )}

      {/* wrap-anywhere, not break-words: only anywhere reduces min-content for long words. */}
      <div
        className="leading-6 text-text-primary wrap-anywhere max-w-full markdown-body"
        style={{ fontSize: "var(--chat-font-size)" }}
        dir="auto"
        onCopy={copyAsMarkdown}
      >
        {[
          ...segments.map((segment, segmentIndex) =>
            isWork(segment[0]) ? (
              <WorkGroup
                key={segment[0].id}
                steps={segment}
                active={
                  live && isGenerating && segmentIndex === segments.length - 1
                }
                language={settings.language}
                t={t}
              >
                {segment.map(renderStep)}
              </WorkGroup>
            ) : (
              renderStep(segment[0])
            ),
          ),
          isLast && isGenerating ? <BrowserConsentCard key="consent" t={t} /> : null,
          (!isFailed || hasGeneratedText) && !bodyInStep ? (
            <div key={bodyKey} className={isFailed ? "mb-3" : undefined}>
              {live ? (
                <StreamingMarkdown
                  source={normalizeMath(parseQuestions(text).cleanText)}
                  streaming={isGenerating}
                  animateOnMount={false}
                  components={MARKDOWN_COMPONENTS}
                />
              ) : (
                <ReactMarkdown
                  remarkPlugins={REMARK_PLUGINS}
                  rehypePlugins={REHYPE_PLUGINS}
                  components={MARKDOWN_COMPONENTS}
                >
                  {normalizeMath(parseQuestions(text).cleanText)}
                </ReactMarkdown>
              )}
              {matchingSession && (
                matchingSession.status === "active" ? (
                  <QuestionCard
                    key={matchingSession.id}
                    session={matchingSession}
                    onAnswer={questionCtx?.onAnswer ?? (() => {})}
                    onSkip={questionCtx?.onSkip}
                    onNavigate={questionCtx?.onNavigate}
                    onComplete={questionCtx?.onComplete}
                    t={questionCtx?.t ?? t}
                  />
                ) : (
                  <QuestionHistoryCard
                    key={matchingSession.id}
                    session={matchingSession}
                    t={questionCtx?.t ?? t}
                  />
                )
              )}
            </div>
          ) : null,
          isFailed ? (
            <div
              key="failure"
              role="alert"
              className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-sm border border-rule bg-surface-base px-3 py-2.5"
            >
              <Icon
                name="warning-circle"
                size={20}
                className="text-danger flex-shrink-0 mt-0.5"
              />
              <div className="min-w-0 flex-1 text-[14px] [&_p]:mb-1">
                {friendlyError ? (
                  <>
                    <p className="mb-1">{friendlyError}</p>
                    <p className="text-[12px] text-text-tertiary wrap-anywhere">{errorMessage}</p>
                  </>
                ) : (
                  <ReactMarkdown
                    remarkPlugins={REMARK_PLUGINS}
                    components={MARKDOWN_COMPONENTS}
                  >
                    {errorMessage}
                  </ReactMarkdown>
                )}
              </div>
              {isLast && !isGenerating && (
                <>
                  <Button
                    variant="secondary"
                    size="dense"
                    icon={<Icon name="arrow-clockwise" size={16} />}
                    onClick={() => onRegenerate(idx)}
                  >
                    {t("regenerateResponse")}
                  </Button>
                  {hasGeneratedText && onResume && (
                    <Button variant="ghost" size="dense" onClick={onResume}>
                      {t("resumeReply")}
                    </Button>
                  )}
                </>
              )}
            </div>
          ) : null,
        ]}

        {showsTailMark(steps, isGenerating, isLast) && <WorkingStatus language={settings.language} />}
      </div>

      {!isGenerating && files.length > 0 && (
        <div
          className="mt-3 flex flex-wrap items-center gap-1.5"
          aria-label={t("filesTouched")}
          role="group"
        >
          {files.map((file) => (
            <Chip
              key={file.path}
              label={file.name}
              title={file.path}
              icon={
                <Icon
                  name={file.created ? "file-arrow-up" : "pencil-simple"}
                  size={14}
                />
              }
              onClick={() => openTouched(file.path)}
            />
          ))}
        </div>
      )}

      {!isFailed && (displayMsg.stopped || msg.interrupted) && (
        <div role="status" className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-text-secondary">
          <span>{msg.interrupted ? t("replyInterrupted") : t("replyStopped")}</span>
          {isLast && !isGenerating && onResume && (
            <Button variant="ghost" size="dense" onClick={onResume}>
              {msg.interrupted ? t("resumeReply") : t("continueGenerating")}
            </Button>
          )}
        </div>
      )}

      {(!isFailed || totalVersions > 1 || hasGeneratedText) && (
        <TurnActions
          idx={idx}
          text={text}
          isGenerating={isGenerating}
          isLast={isLast}
          copiedIndex={copiedIndex}
          copyToClipboard={copyToClipboard}
          onRegenerate={onRegenerate}
          onSwitchVersion={onSwitchVersion}
          totalVersions={totalVersions}
          currentVersionIndex={currentVersionIndex}
          currentVersionNum={currentVersionNum}
          metrics={displayMsg.metrics}
          showMetrics={settings.showMetrics}
          chatId={chatId}
          isFailed={isFailed}
          t={t}
        />
      )}

      {msg.fold && <FoldLine fold={msg.fold} t={t} />}

      <Lightbox
        open={Boolean(previewFile)}
        src={previewFile?.content}
        alt={previewFile?.name}
        onClose={() => setPreviewFile(null)}
      />
    </>
  );
}
export default AssistantTurn;
