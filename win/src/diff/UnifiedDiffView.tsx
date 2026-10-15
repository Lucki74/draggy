import React from "react";
import { Icon } from "../ui/icons/Icon";
import type { DiffLine, ParsedFileDiff } from "./diffParser";

export interface ReviewComment {
  id: string;
  file: string;
  line: number;
  text: string;
}

interface UnifiedDiffViewProps {
  fileDiff: ParsedFileDiff;
  comments: ReviewComment[];
  activeCommentLine: number | null;
  commentDraft: string;
  onStartComment: (line: number) => void;
  onCancelComment: () => void;
  onChangeCommentDraft: (text: string) => void;
  onSaveComment: (line: number) => void;
  onDeleteComment: (commentId: string) => void;
  t: (key: string) => string;
}

const TINTS: Record<DiffLine["kind"], string> = {
  added: "bg-[color-mix(in_srgb,var(--ok)_10%,transparent)] text-text-primary",
  removed: "bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] text-text-primary",
  context: "text-text-secondary",
};

const GUTTER_MARKS: Record<DiffLine["kind"], string> = {
  added: "+",
  removed: "-",
  context: " ",
};

const GUTTER_CLASSES: Record<DiffLine["kind"], string> = {
  added: "text-ok font-semibold",
  removed: "text-danger font-semibold",
  context: "text-text-tertiary",
};

/** Unified line-by-line diff view with tinted gutters and inline review comments. */
export function UnifiedDiffView({
  fileDiff,
  comments,
  activeCommentLine,
  commentDraft,
  onStartComment,
  onCancelComment,
  onChangeCommentDraft,
  onSaveComment,
  onDeleteComment,
  t,
}: UnifiedDiffViewProps) {
  const filePath = fileDiff.newPath || fileDiff.oldPath;

  return (
    <div dir="ltr" className="font-mono text-[12px] leading-5 select-text overflow-x-auto">
      {fileDiff.hunks.map((hunk, hIdx) => (
        <div key={hIdx} className="border-b border-rule last:border-b-0">
          <div className="flex items-center px-3 py-1 bg-surface-raised/60 text-text-tertiary text-[11px] select-none border-y border-rule">
            {hunk.header}
          </div>

          {hunk.lines.map((line, lIdx) => {
            const lineNum = line.afterLine ?? line.beforeLine ?? lIdx;
            const lineComments = comments.filter(
              (c) => c.file === filePath && c.line === lineNum,
            );
            const isCommenting = activeCommentLine === lineNum;

            return (
              <React.Fragment key={`${hIdx}-${lIdx}`}>
                <div
                  className={`group relative flex items-start min-w-full hover:bg-surface-raised/30 transition-colors ${
                    TINTS[line.kind]
                  }`}
                >
                  <span className="w-10 flex-shrink-0 select-none pe-2 text-end text-[11px] text-text-tertiary">
                    {line.beforeLine ?? ""}
                  </span>
                  <span className="w-10 flex-shrink-0 select-none pe-2 text-end text-[11px] text-text-tertiary">
                    {line.afterLine ?? ""}
                  </span>
                  <span
                    className={`w-5 flex-shrink-0 select-none text-center ${
                      GUTTER_CLASSES[line.kind]
                    }`}
                  >
                    {GUTTER_MARKS[line.kind]}
                  </span>
                  <span className="flex-1 whitespace-pre pe-4 break-words">
                    {line.text || " "}
                  </span>

                  {/* Add comment action trigger */}
                  <div className="absolute end-2 top-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      data-testid="start-comment"
                      onClick={() => onStartComment(lineNum)}
                      title={t("addComment")}
                      aria-label={t("addComment")}
                      className="p-1 rounded-xs bg-surface-base border border-rule shadow-xs hover:bg-surface-raised text-text-secondary hover:text-text-primary"
                    >
                      <Icon name="chat-circle" size={12} />
                    </button>
                  </div>
                </div>

                {/* Existing review comments on this line */}
                {lineComments.map((comment) => (
                  <div
                    key={comment.id}
                    className="ms-20 my-1 me-4 p-2.5 rounded-sm bg-surface-base border border-rule shadow-xs font-sans text-[12px]"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1 text-text-secondary text-[11px]">
                      <span className="font-semibold text-text-primary">
                        {t("reviewComments")}
                      </span>
                      <button
                        type="button"
                        onClick={() => onDeleteComment(comment.id)}
                        className="text-text-tertiary hover:text-danger p-0.5"
                      >
                        <Icon name="trash" size={12} />
                      </button>
                    </div>
                    <p className="text-text-primary whitespace-pre-wrap">{comment.text}</p>
                  </div>
                ))}

                {/* Inline comment draft editor */}
                {isCommenting && (
                  <div className="ms-20 my-1.5 me-4 p-3 rounded-sm bg-surface-base border border-rule-strong shadow-md font-sans text-[12px]">
                    <textarea
                      autoFocus
                      rows={2}
                      value={commentDraft}
                      onChange={(e) => onChangeCommentDraft(e.target.value)}
                      placeholder={t("commentPlaceholder")}
                      className="w-full p-2 rounded-xs border border-rule bg-surface-canvas text-text-primary text-[12px] resize-none focus:outline-none focus:border-focus"
                    />
                    <div className="flex items-center justify-end gap-2 mt-2">
                      <button
                        type="button"
                        onClick={onCancelComment}
                        className="px-2.5 py-1 rounded-xs border border-rule text-text-secondary hover:text-text-primary hover:bg-surface-raised text-[11px]"
                      >
                        {t("cancel")}
                      </button>
                      <button
                        type="button"
                        data-testid="save-comment"
                        disabled={!commentDraft.trim()}
                        onClick={() => onSaveComment(lineNum)}
                        className="px-2.5 py-1 rounded-xs bg-text-primary text-surface-base disabled:opacity-40 text-[11px] font-semibold"
                      >
                        {t("addComment")}
                      </button>
                    </div>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      ))}
    </div>
  );
}
