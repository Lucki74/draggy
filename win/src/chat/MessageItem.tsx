import { memo } from "react";
import { motion } from "framer-motion";
import { translations } from "./../translations";
import UserTurn from "./UserTurn";
import AssistantTurn from "./AssistantTurn";
import type {
  ApprovalAnswer,
  AppSettings,
  Message,
} from "./../types";

export interface MessageItemProps {
  msg: Message;
  idx: number;
  isGenerating: boolean;
  isLast: boolean;
  onRegenerate: (index: number) => void;
  onResume?: () => void;
  onSwitchVersion: (messageIndex: number, versionIndex: number) => void;
  copiedIndex: number | null;
  copyToClipboard: (text: string, idx: number) => void;
  settings: AppSettings;
  onEditMessage: (messageIndex: number, newContent: string) => void;
  onApproval?: (approvalId: string, answer: ApprovalAnswer) => void;
  onRevert?: (checkpointId: number) => Promise<boolean>;
  chatId?: string;
}

// Single conversation turn and attached steps. Memoization avoids re-rendering earlier turns.
const MessageItem = memo(
  ({
    msg,
    idx,
    isGenerating,
    isLast,
    onRegenerate,
    onResume,
    onSwitchVersion,
    copiedIndex,
    copyToClipboard,
    settings,
    onEditMessage,
    onApproval,
    onRevert,
    chatId,
  }: MessageItemProps) => {
    const t = (key: string) => {
      return (
        translations[settings.language]?.[key] || translations["en"][key] || key
      );
    };

    const totalVersions = (msg.versions?.length || 0) + 1;
    const currentVersionIndex = msg.currentVersionIndex ?? totalVersions - 1;
    const currentVersionNum = currentVersionIndex + 1;

    const displayMsg =
      msg.versions && currentVersionIndex < msg.versions.length
        ? msg.versions[currentVersionIndex]
        : msg;

    const text = displayMsg.textContent ?? displayMsg.content;
    const steps = displayMsg.steps || [];
    const live = isLast && msg.role === "assistant";

    return (
      <motion.div
        key={msg.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={`message-container group/msg flex max-w-[760px] mx-auto w-full ${
          msg.role === "user" ? "justify-end" : "justify-start"
        }`}
      >
        <div className={`flex flex-col min-w-0 ${msg.role === "user" ? "items-end max-w-[85%]" : "items-stretch w-full"}`}>
          {msg.role === "user" ? (
            <UserTurn
              msg={msg}
              idx={idx}
              text={text}
              onEditMessage={onEditMessage}
              t={t}
            />
          ) : (
            <AssistantTurn
              msg={msg}
              displayMsg={displayMsg}
              idx={idx}
              text={text}
              steps={steps}
              live={live}
              isGenerating={isGenerating}
              isLast={isLast}
              onRegenerate={onRegenerate}
              onResume={onResume}
              onSwitchVersion={onSwitchVersion}
              copiedIndex={copiedIndex}
              copyToClipboard={copyToClipboard}
              settings={settings}
              onApproval={onApproval}
              onRevert={onRevert}
              chatId={chatId}
              totalVersions={totalVersions}
              currentVersionIndex={currentVersionIndex}
              currentVersionNum={currentVersionNum}
              t={t}
            />
          )}
        </div>
      </motion.div>
    );
  },
  (prev, next) => {
    return (
      prev.msg === next.msg &&
      prev.idx === next.idx &&
      prev.isGenerating === next.isGenerating &&
      prev.isLast === next.isLast &&
      prev.copiedIndex === next.copiedIndex &&
      prev.chatId === next.chatId &&
      // Only what a message reads, avoiding re-renders when unrelated settings change.
      prev.settings.language === next.settings.language &&
      prev.settings.showMetrics === next.settings.showMetrics
    );
  },
);
export default MessageItem;
