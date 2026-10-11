import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../ui/icons/Icon";
import { CHANGE_COLOR, CHANGE_LETTER, changePath } from "../project/gitView";
import { parseDiff, parseDiffStats } from "./diffParser";
import { UnifiedDiffView, type ReviewComment } from "./UnifiedDiffView";
import { SplitDiffView } from "./SplitDiffView";
import type { GitChange, GitStatus } from "../types";
import { logSwallow } from "../logger";

export interface DiffPaneProps {
  workspaceId: string;
  rootPath?: string | null;
  initialFile?: string | null;
  gitStatus?: GitStatus | null;
  t: (key: string) => string;
  onOpenFile?: (path: string) => void;
  onSendReviewComment?: (prompt: string) => void;
  onClose?: () => void;
  width?: number;
}

/** Full-featured repository diff pane with file list, unified/split views and review comments. */
export function DiffPane({
  workspaceId,
  rootPath,
  initialFile,
  gitStatus: initialGitStatus,
  t,
  onOpenFile,
  onSendReviewComment,
  width = 600,
}: DiffPaneProps) {
  const [liveGitStatus, setLiveGitStatus] = useState<GitStatus | null>(null);
  const gitStatus = initialGitStatus ?? liveGitStatus;
  const files: GitChange[] = useMemo(() => gitStatus?.files ?? [], [gitStatus]);

  const [chosenFile, setChosenFile] = useState<string | null>(null);
  const selectedFile = chosenFile ?? initialFile ?? files[0]?.path ?? null;

  const [viewMode, setViewMode] = useState<"unified" | "split">("unified");
  const [rawDiff, setRawDiff] = useState<string>("");
  const [loading, setLoading] = useState(() => Boolean(window.electronAPI?.git));
  const [error, setError] = useState<string | null>(null);

  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [activeCommentLine, setActiveCommentLine] = useState<number | null>(null);
  const [commentDraft, setCommentDraft] = useState("");

  const refreshStatus = useCallback(async () => {
    if (!window.electronAPI?.git) return;
    try {
      const res = await window.electronAPI.git.status(workspaceId);
      if (res?.success) setLiveGitStatus(res);
    } catch (error) {
      logSwallow("diff", error, "retain last known status if refresh fails");
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!initialGitStatus && window.electronAPI?.git) {
      let mounted = true;
      window.electronAPI.git.status(workspaceId).then((res) => {
        if (mounted && res?.success) setLiveGitStatus(res);
      });
      return () => {
        mounted = false;
      };
    }
  }, [initialGitStatus, workspaceId]);

  const fetchDiff = useCallback(async () => {
    if (!window.electronAPI?.git) return;
    setLoading(true);
    setError(null);
    try {
      const res = await window.electronAPI.git.diff(workspaceId, ".");
      if (res?.success) {
        setRawDiff(res.diff || "");
      } else {
        setError(res?.error || t("gitNoDiff"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [workspaceId, t]);

  useEffect(() => {
    let mounted = true;
    if (!window.electronAPI?.git) return;
    window.electronAPI.git.diff(workspaceId, ".").then(
      (res) => {
        if (!mounted) return;
        if (res?.success) {
          setRawDiff(res.diff || "");
        } else {
          setError(res?.error || t("gitNoDiff"));
        }
        setLoading(false);
      },
      (err) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      },
    );
    return () => {
      mounted = false;
    };
  }, [workspaceId, t]);

  const parsedFiles = useMemo(() => parseDiff(rawDiff), [rawDiff]);
  const statsMap = useMemo(() => parseDiffStats(rawDiff), [rawDiff]);

  const currentFileDiff = useMemo(() => {
    if (!selectedFile) return parsedFiles[0] ?? null;
    return (
      parsedFiles.find(
        (f) => f.newPath === selectedFile || f.oldPath === selectedFile,
      ) ?? null
    );
  }, [parsedFiles, selectedFile]);

  const branch = gitStatus?.detached
    ? t("gitDetached")
    : (gitStatus?.branch ?? "HEAD");

  const handleStartComment = (line: number) => {
    setActiveCommentLine(line);
    setCommentDraft("");
  };

  const handleCancelComment = () => {
    setActiveCommentLine(null);
    setCommentDraft("");
  };

  const handleSaveComment = (line: number) => {
    const targetFile = selectedFile || currentFileDiff?.newPath || currentFileDiff?.oldPath;
    if (!targetFile || !commentDraft.trim()) return;
    const newComment: ReviewComment = {
      id: `${Date.now()}-${Math.random()}`,
      file: targetFile,
      line,
      text: commentDraft.trim(),
    };
    setComments((prev) => [...prev, newComment]);
    setActiveCommentLine(null);
    setCommentDraft("");
  };

  const handleDeleteComment = (commentId: string) => {
    setComments((prev) => prev.filter((c) => c.id !== commentId));
  };

  const handleSendReview = useCallback(() => {
    if (comments.length === 0 || !onSendReviewComment) return;
    const summary = comments
      .map((c) => `- ${c.file}:${c.line}: ${c.text}`)
      .join("\n");
    const prompt = `Review comments on changes:\n\n${summary}`;
    onSendReviewComment(prompt);
    setComments([]);
  }, [comments, onSendReviewComment]);

  // Ctrl+Enter sends pending review comments to the assistant
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && comments.length > 0) {
        e.preventDefault();
        handleSendReview();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [comments.length, handleSendReview]);

  const canShowSplit = width >= 900;

  return (
    <div className="flex flex-col h-full bg-surface-canvas overflow-hidden select-none">
      {/* GitStrip Header embedded at the top of the Diff pane */}
      <div className="h-10 px-3 flex items-center justify-between border-b border-rule bg-surface-base flex-shrink-0 gap-2 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <Icon name="git-branch" size={14} className="text-text-secondary flex-shrink-0" />
          <span className="font-semibold text-text-primary truncate" title={branch}>
            {branch}
          </span>

          {(gitStatus?.ahead ?? 0) > 0 && (
            <span
              className="inline-flex items-center gap-0.5 text-[11px] text-text-secondary"
              title={t("gitAhead")}
            >
              <Icon name="arrow-up" size={12} />
              {gitStatus?.ahead}
            </span>
          )}
          {(gitStatus?.behind ?? 0) > 0 && (
            <span
              className="inline-flex items-center gap-0.5 text-[11px] text-text-secondary"
              title={t("gitBehind")}
            >
              <Icon name="arrow-down" size={12} />
              {gitStatus?.behind}
            </span>
          )}

          <span className="text-[11px] text-text-secondary ms-1">
            {files.length === 0
              ? t("gitClean")
              : t("gitChangedFiles").replace("{count}", String(files.length))}
          </span>
        </div>

        {/* View mode toggle and tools */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {canShowSplit && (
            <div className="flex items-center rounded-pill border border-rule p-0.5 bg-surface-canvas text-[11px]">
              <button
                type="button"
                onClick={() => setViewMode("unified")}
                className={`px-2 py-0.5 rounded-pill font-medium transition-colors ${
                  viewMode === "unified"
                    ? "bg-surface-raised text-text-primary shadow-xs"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {t("unifiedDiff")}
              </button>
              <button
                type="button"
                onClick={() => setViewMode("split")}
                className={`px-2 py-0.5 rounded-pill font-medium transition-colors ${
                  viewMode === "split"
                    ? "bg-surface-raised text-text-primary shadow-xs"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {t("splitDiff")}
              </button>
            </div>
          )}

          {selectedFile && onOpenFile && (
            <button
              type="button"
              onClick={() => onOpenFile(rootPath ? changePath(rootPath, selectedFile) : selectedFile)}
              title={t("openFile")}
              className="p-1 rounded-xs border border-rule hover:bg-surface-raised text-text-secondary hover:text-text-primary transition-colors"
            >
              <Icon name="arrow-square-out" size={14} />
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              void refreshStatus();
              void fetchDiff();
            }}
            title={t("views")}
            className="p-1 rounded-xs border border-rule hover:bg-surface-raised text-text-secondary hover:text-text-primary transition-colors"
          >
            <Icon name="arrow-clockwise" size={14} />
          </button>
        </div>
      </div>

      {/* Main body: File list on start side, Diff viewer on end side */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Changed file list */}
        <div className="w-56 flex-shrink-0 border-e border-rule flex flex-col bg-surface-base overflow-y-auto">
          {files.length === 0 ? (
            <div className="p-4 text-center text-text-tertiary text-xs">
              {t("gitClean")}
            </div>
          ) : (
            <div className="py-1">
              {files.map((file) => {
                const isSelected = file.path === selectedFile;
                const stats = statsMap[file.path];

                return (
                  <button
                    key={`${file.kind}:${file.path}`}
                    type="button"
                    onClick={() => setChosenFile(file.path)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-start text-xs transition-colors border-s-2 ${
                      isSelected
                        ? "bg-surface-canvas border-text-primary text-text-primary font-medium"
                        : "border-transparent text-text-secondary hover:bg-surface-raised hover:text-text-primary"
                    }`}
                  >
                    <span
                      className="w-3 text-center text-[10px] font-semibold flex-shrink-0"
                      style={{ color: CHANGE_COLOR[file.kind] }}
                    >
                      {CHANGE_LETTER[file.kind]}
                    </span>

                    <span className="truncate flex-1 min-w-0" title={file.path}>
                      {file.path}
                    </span>

                    {stats && (stats.added > 0 || stats.removed > 0) && (
                      <span className="flex items-center gap-1 font-mono text-[10px] tabular-nums flex-shrink-0">
                        {stats.added > 0 && (
                          <span className="text-ok">+{stats.added}</span>
                        )}
                        {stats.removed > 0 && (
                          <span className="text-danger">-{stats.removed}</span>
                        )}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Diff content view */}
        <div className="flex-1 min-w-0 flex flex-col bg-surface-canvas overflow-y-auto">
          {loading ? (
            <div className="flex-1 flex items-center justify-center p-8 text-text-secondary text-xs">
              <Icon name="circle-notch" size={18} className="animate-spin me-2" />
              <span>{t("gitCheckingStatus")}</span>
            </div>
          ) : error ? (
            <div className="p-6 text-center text-danger text-xs">{error}</div>
          ) : !currentFileDiff ? (
            <div className="flex-1 flex items-center justify-center p-8 text-text-tertiary text-xs">
              {t("gitNoDiff")}
            </div>
          ) : viewMode === "split" && canShowSplit ? (
            <SplitDiffView
              fileDiff={currentFileDiff}
              comments={comments}
              activeCommentLine={activeCommentLine}
              commentDraft={commentDraft}
              onStartComment={handleStartComment}
              onCancelComment={handleCancelComment}
              onChangeCommentDraft={setCommentDraft}
              onSaveComment={handleSaveComment}
              onDeleteComment={handleDeleteComment}
              t={t}
            />
          ) : (
            <UnifiedDiffView
              fileDiff={currentFileDiff}
              comments={comments}
              activeCommentLine={activeCommentLine}
              commentDraft={commentDraft}
              onStartComment={handleStartComment}
              onCancelComment={handleCancelComment}
              onChangeCommentDraft={setCommentDraft}
              onSaveComment={handleSaveComment}
              onDeleteComment={handleDeleteComment}
              t={t}
            />
          )}
        </div>
      </div>

      {/* Review comments bottom bar */}
      {comments.length > 0 && (
        <div className="h-11 px-4 border-t border-rule bg-surface-base flex items-center justify-between flex-shrink-0 shadow-lg text-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-text-primary">
              {comments.length} {t("reviewComments")}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setComments([])}
              className="px-2.5 py-1 rounded-xs border border-rule text-text-secondary hover:text-text-primary text-[11px]"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={handleSendReview}
              className="px-3 py-1 rounded-xs bg-text-primary text-surface-base font-semibold hover:opacity-90 text-[11px] flex items-center gap-1.5"
            >
              <span>{t("sendReview")}</span>
              <kbd className="px-1 py-0.2 rounded-xs bg-surface-base/20 text-[10px]">
                Ctrl+Enter
              </kbd>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
export default DiffPane;
