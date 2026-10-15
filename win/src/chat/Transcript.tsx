import React, { useEffect, useMemo, useRef, useState } from "react";
import MessageItem from "./MessageItem";
import { TranscriptViewContext } from "./transcriptView";
import InView from "./InView";
import { JUMP_LIST_MIN_PROMPTS, PromptJumpList } from "./PromptJumpList";
import { ErrorBoundary } from "../ErrorBoundary";
import { Button, Icon } from "../ui";
import type { AppSettings, ApprovalAnswer, ChatSession } from "../types";

export interface TranscriptProps {
  chat: ChatSession;
  copiedIndex: number | null;
  settings: AppSettings;
  onRegenerate: (index: number) => void;
  onSwitchVersion: (messageIndex: number, versionIndex: number) => void;
  onEditMessage: (messageIndex: number, newContent: string) => void;
  onApproval?: (approvalId: string, answer: ApprovalAnswer) => void;
  onRevert?: (checkpointId: number) => Promise<boolean>;
  copyToClipboard: (text: string, idx: number) => Promise<void>;
  t: (key: string) => string;
}

/* Scrollable message transcript managing automatic stream following and view virtualization. */
export function Transcript({
  chat,
  copiedIndex,
  settings,
  onRegenerate,
  onSwitchVersion,
  onEditMessage,
  onApproval,
  onRevert,
  copyToClipboard,
  t,
}: TranscriptProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isAtBottom = useRef(true);
  const lastScrollTop = useRef(0);
  const draggingScroll = useRef(false);
  // Mirrors isAtBottom for rendering; the ref stays the source of truth for the follow loop.
  const [scrolledAway, setScrolledAway] = useState(false);
  const prevGenerating = useRef(chat.isGenerating);
  const [turnAnnouncement, setTurnAnnouncement] = useState("");

  useEffect(() => {
    if (prevGenerating.current && !chat.isGenerating && chat.messages.length > 0) {
      setTurnAnnouncement(t("turnComplete"));
    }
    prevGenerating.current = chat.isGenerating;
  }, [chat.isGenerating, chat.messages.length, t]);

  const prompts = useMemo(
    () => chat.messages.filter((msg) => msg.role === "user").map((msg) => ({ id: msg.id, text: msg.content })),
    [chat.messages],
  );
  const showJumpList = prompts.length >= JUMP_LIST_MIN_PROMPTS;
  const [currentPrompt, setCurrentPrompt] = useState<string | null>(null);

  const anchors = () =>
    [...(scrollContainerRef.current?.querySelectorAll<HTMLElement>("[data-anchor]") ?? [])];

  /** The last prompt whose top has scrolled past the top of the transcript. */
  const trackPrompt = () => {
    const box = scrollContainerRef.current;
    if (!box) return;
    const top = box.getBoundingClientRect().top + 48;
    let found: string | null = null;
    for (const node of anchors()) {
      if (node.getBoundingClientRect().top > top) break;
      found = node.dataset.anchor ?? null;
    }
    setCurrentPrompt(found ?? prompts[0]?.id ?? null);
  };

  const jumpToPrompt = (id: string) => {
    setAtBottom(false);
    const node = anchors().find((one) => one.dataset.anchor === id);
    // Instant: turns mount as they come into view, so an animated scroll would land short.
    if (node) scrollNodeTo(node, "start", "auto");
    setCurrentPrompt(id);
  };

  /** Scrolls only the transcript. `scrollIntoView` also moves every overflow-hidden ancestor, which shoves the whole app up. */
  const scrollNodeTo = (node: HTMLElement, block: "start" | "center", behavior: ScrollBehavior) => {
    const box = scrollContainerRef.current;
    if (!box) return;
    const offset = node.getBoundingClientRect().top - box.getBoundingClientRect().top;
    const lead = block === "center" ? (box.clientHeight - node.offsetHeight) / 2 : 16;
    box.scrollTo?.({ top: box.scrollTop + offset - lead, behavior });
  };

  const scrollBoxToEnd = (behavior: ScrollBehavior) => {
    const box = scrollContainerRef.current;
    box?.scrollTo?.({ top: box.scrollHeight, behavior });
  };

  const setAtBottom = (value: boolean) => {
    isAtBottom.current = value;
    setScrolledAway(!value);
  };

  // Jumps to the bottom when opening a different conversation.
  useEffect(() => {
    isAtBottom.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets jump state on conversation switch
    setScrolledAway(false);
    setCurrentPrompt(null);
    scrollBoxToEnd("auto");
  }, [chat.id]);

  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } =
      scrollContainerRef.current;
    const distance = scrollHeight - scrollTop - clientHeight;
    // Any step up lets go of the bottom, however close; only coming back down re-engages it.
    if (scrollTop < lastScrollTop.current && distance > 1) setAtBottom(false);
    else if (distance < 100) setAtBottom(true);
    lastScrollTop.current = scrollTop;
    if (showJumpList) trackPrompt();
  };

  const scrollInput = {
    onWheel: (event: React.WheelEvent) => {
      if (event.deltaY < 0) setAtBottom(false);
    },
    onPointerDown: () => {
      draggingScroll.current = true;
    },
    onPointerUp: () => {
      draggingScroll.current = false;
    },
    onTouchStart: () => {
      draggingScroll.current = true;
    },
    onTouchEnd: () => {
      draggingScroll.current = false;
    },
  };

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    if (isAtBottom.current) {
      scrollBoxToEnd(behavior);
    }
  };

  useEffect(() => {
    if (chat.isGenerating) return;
    scrollToBottom("smooth");
  }, [chat.messages, chat.isGenerating]);

  // Follows active generation without trailing inertia after completion.
  useEffect(() => {
    if (!chat.isGenerating) return;
    let frame = 0;

    const follow = () => {
      const box = scrollContainerRef.current;
      if (
        box &&
        isAtBottom.current &&
        box.scrollHeight - box.scrollTop - box.clientHeight > 1
      ) {
        box.scrollTop = box.scrollHeight;
      }
      frame = requestAnimationFrame(follow);
    };

    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  }, [chat.isGenerating]);

  // A tool call the turn is parked on; when it has scrolled out of view the bar brings it back.
  const pending = chat.messages
    .at(-1)
    ?.steps?.find((step) => step.type === "approval" && step.approval && !step.answer)?.approval;

  const showApproval = () => {
    if (!pending) return;
    const card = [
      ...(scrollContainerRef.current?.querySelectorAll<HTMLElement>("[data-approval]") ?? []),
    ].find((node) => node.dataset.approval === pending.id);
    if (card) scrollNodeTo(card, "center", "smooth");
    card?.querySelector("button")?.focus({ preventScroll: true });
  };

  const jumpToLatest = () => {
    setAtBottom(true);
    scrollBoxToEnd("smooth");
  };

  return (
    <TranscriptViewContext.Provider value={chat.view ?? "normal"}>
    <div data-region="transcript" tabIndex={-1} className="relative flex-1 min-h-0 flex flex-col">
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        {...scrollInput}
        className="flex-1 overflow-y-auto p-6 space-y-6 pt-10"
      >
        {chat.messages.map((msg, idx) => (
          <InView
            key={msg.id}
            estimatedHeight={100}
            forceRender={idx === chat.messages.length - 1 && chat.isGenerating}
            anchor={showJumpList && msg.role === "user" ? msg.id : undefined}
            className="scroll-mt-4"
          >
            <ErrorBoundary>
              {chat.compaction?.throughIndex === idx && (
                <div className="max-w-[760px] mx-auto py-4 flex items-center gap-3">
                  <div className="h-px flex-1 bg-rule" />
                  <span className="text-[12px] text-text-secondary whitespace-nowrap">
                    {t("earlierCondensed")}
                  </span>
                  <div className="h-px flex-1 bg-rule" />
                </div>
              )}
              <MessageItem
                chatId={chat.id}
                msg={msg}
                idx={idx}
                isGenerating={chat.isGenerating}
                isLast={idx === chat.messages.length - 1}
                onRegenerate={onRegenerate}
                onSwitchVersion={onSwitchVersion}
                copiedIndex={copiedIndex}
                copyToClipboard={copyToClipboard}
                settings={settings}
                onEditMessage={onEditMessage}
                onApproval={onApproval}
                onRevert={onRevert}
              />
            </ErrorBoundary>
          </InView>
        ))}
        <div ref={messagesEndRef} />
        <div aria-live="polite" className="sr-only">
          {turnAnnouncement}
        </div>
      </div>
      {showJumpList && (
        <PromptJumpList
          prompts={prompts}
          current={currentPrompt ?? prompts.at(-1)?.id ?? null}
          onJump={jumpToPrompt}
          t={t}
        />
      )}
      {scrolledAway && pending ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-4">
          <div
            role="status"
            className="pointer-events-auto flex items-center gap-3 rounded-md border border-rule-strong bg-surface-base py-1.5 ps-3 pe-1.5 shadow-sm"
          >
            <span className="text-[13px] text-warn">{t("approvalNeeded")}</span>
            <Button variant="secondary" size="dense" onClick={showApproval}>
              {t("showApproval")}
            </Button>
          </div>
        </div>
      ) : scrolledAway && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <Button
            variant="secondary"
            size="dense"
            className="pointer-events-auto shadow-sm"
            icon={
              chat.isGenerating ? (
                <span className="relative flex h-2 w-2" aria-hidden="true">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-ember-1 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-ember-2" />
                </span>
              ) : (
                <Icon name="arrow-down" size={16} />
              )
            }
            onClick={jumpToLatest}
          >
            {t("jumpToLatest")}
          </Button>
        </div>
      )}
    </div>
    </TranscriptViewContext.Provider>
  );
}
