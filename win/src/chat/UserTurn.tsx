import { useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { normalizeMath, sanitizeContent } from "../utils";
import { REHYPE_PLUGINS, REMARK_PLUGINS } from "./markdown";
import { copyAsMarkdown } from "./copyMarkdown";
import { Button, Icon, IconButton, Lightbox } from "../ui";
import type { Attachment, Message } from "../types";

export interface UserTurnProps {
  msg: Message;
  idx: number;
  text: string;
  onEditMessage: (messageIndex: number, newContent: string) => void;
  t: (key: string) => string;
}

// The user's own turn: a raised block on the end side, attachments above it, editable in place.
export function UserTurn({ msg, idx, text, onEditMessage, t }: UserTurnProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [previewFile, setPreviewFile] = useState<Attachment | null>(null);
  const [editWidth, setEditWidth] = useState(0);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const attachments = msg.attachments ?? [];

  // The editor grows with its text instead of scrolling inside a small box.
  useLayoutEffect(() => {
    const field = editorRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }, [isEditing, editContent, editWidth]);

  return (
    <div className="group/turn flex flex-col items-end gap-1.5 max-w-full">
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 justify-end">
          {attachments.map((file, fIdx) =>
            file.type.startsWith("image/") ? (
              <button
                key={fIdx}
                type="button"
                onClick={() => setPreviewFile(file)}
                title={file.name}
                className="rounded-sm overflow-hidden border border-rule hover:border-rule-strong focus-visible:outline-2 focus-visible:outline-offset-2 cursor-pointer"
              >
                <img src={file.content} alt={file.name} className="block w-40 h-40 object-cover" />
              </button>
            ) : (
              <span
                key={fIdx}
                title={file.name}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-pill border border-rule bg-surface-base text-[13px] text-text-secondary"
              >
                <Icon name={file.type.startsWith("video/") ? "film-strip" : "file-text"} size={14} />
                <span className="truncate max-w-[180px] text-text-primary">{file.name}</span>
              </span>
            ),
          )}
        </div>
      )}

      {isEditing ? (
        <div
          className="flex flex-col gap-2 max-w-full min-w-[min(320px,100%)] px-4 py-2.5 rounded-md bg-surface-raised"
          style={{ width: editWidth || undefined }}
        >
          <textarea
            ref={editorRef}
            rows={1}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            aria-label={t("edit")}
            dir="auto"
            autoFocus
            className="w-full bg-transparent outline-none resize-none overflow-hidden text-text-primary leading-6"
            style={{ fontSize: "var(--chat-font-size)" }}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="dense" onClick={() => setIsEditing(false)}>
              {t("cancel")}
            </Button>
            <Button
              variant="primary"
              size="dense"
              onClick={() => {
                onEditMessage(idx, editContent);
                setIsEditing(false);
              }}
            >
              {t("save")}
            </Button>
          </div>
        </div>
      ) : (
        <div
          ref={bubbleRef}
          className="px-4 py-2.5 rounded-md bg-surface-raised text-text-primary leading-6 wrap-anywhere max-w-full"
          style={{ fontSize: "var(--chat-font-size)" }}
          dir="auto"
        >
          <div className="markdown-body" onCopy={copyAsMarkdown}>
            <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS}>
              {normalizeMath(
                msg.content.trim()
                  ? sanitizeContent(msg.content)
                  : attachments.length > 0
                    ? `[${t("attachedFiles")}]`
                    : "",
              )}
            </ReactMarkdown>
          </div>
        </div>
      )}

      {!isEditing && (
        <div className="flex opacity-0 group-hover/turn:opacity-100 group-focus-within/turn:opacity-100 transition-opacity">
          <IconButton
            name="pencil-simple"
            label={t("edit")}
            size="sm"
            onClick={() => {
              setEditWidth(bubbleRef.current?.offsetWidth ?? 0);
              setIsEditing(true);
              setEditContent(text);
            }}
          />
        </div>
      )}

      <Lightbox
        open={Boolean(previewFile)}
        src={previewFile?.content}
        alt={previewFile?.name}
        onClose={() => setPreviewFile(null)}
      />
    </div>
  );
}
export default UserTurn;
