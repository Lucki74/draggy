import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  Check,
  ExternalLink,
  FileCode,
  Image as ImageIcon,
  Loader2,
  Pencil,
  Save,
  Trash2,
  X,
} from "lucide-react";

const LINE_HEIGHT = 20;
const OVERSCAN = 40;
import { baseName } from "../files/tree";
import {
  afterSave,
  isCodeFile,
  isDirty,
  isImageFile,
  isMarkdownFile,
  keepMine,
  languageOf,
  lineCount,
  onDiskChange,
  openState,
  prismLanguageOf,
  readChange,
  takeTheirs,
} from "./drafts";
import type { CanvasState, FileChange } from "./drafts";
import ReactMarkdown from "react-markdown";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-async";
import { atomDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  DOCUMENT_REMARK_PLUGINS,
  MARKDOWN_COMPONENTS,
  REHYPE_PLUGINS,
} from "../chat/markdown";

interface CanvasProps {
  workspaceId: string;
  path: string;
  t: (key: string) => string;
  onClose: () => void;
  /** The file was moved while open; the canvas follows it to its new name. */
  onMoved?: (path: string) => void;
  onDelete?: () => void | Promise<void>;
  onRename?: (newName: string) => void | Promise<void>;
  allowExternal?: boolean;
}

/** A project file beside the chat that both the user and the model edit. Saves use the guarded
 * write, so every save is checkpointed and undoable. */
export default function Canvas({
  workspaceId,
  path,
  t,
  onClose,
  onMoved,
  onDelete,
  onRename,
  allowExternal = true,
}: CanvasProps) {
  const [state, setState] = useState<CanvasState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [viewMode, setViewMode] = useState<"edit" | "preview">("edit");
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isMarkdown = isMarkdownFile(path);
  const isImage = isImageFile(path);
  const isSvg = path.toLowerCase().endsWith(".svg");
  const isCode = isCodeFile(path);
  const activeMode = isMarkdown || isSvg ? viewMode : "edit";

  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageDimensions, setImageDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [imageBytes, setImageBytes] = useState<number>(0);
  const [zoom, setZoom] = useState<number>(1);

  const gutterRef = useRef<HTMLPreElement>(null);
  const highlighterRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const api = window.electronAPI?.files;


  // Opening, and following the file when something else changes it.
  useEffect(() => {
    if (!api) return;

    let current = true;

    const load = (apply: (text: string) => void) =>
      api.read(workspaceId, path).then((result) => {
        if (!current) return;

        if (!result?.success) {
          setProblem(result?.error || t("canvasCouldNotOpen"));
          return;
        }

        if (result.isImage || isImageFile(path)) {
          setImageDataUrl(result.dataUrl || "");
          setImageBytes(result.bytes || 0);
          if (typeof result.text === "string" && result.text) {
            apply(result.text);
          }
          setProblem(null);
          return;
        }

        if (typeof result.text !== "string") {
          setProblem(result?.error || t("canvasCouldNotOpen"));
          return;
        }

        setProblem(null);
        apply(result.text);
      });

    void load((text) => setState(openState(text)));

    const stop = api.onChanged?.((change: FileChange) => {
      const meaning = readChange({ workspaceId, path }, change);

      if (meaning === "moved") onMoved?.(change.path);
      if (meaning !== "changed") return;

      void load((text) =>
        setState((previous) => (previous ? onDiskChange(previous, text) : openState(text))),
      );
    });

    return () => {
      current = false;
      stop?.();
    };
  }, [api, workspaceId, path, t, onMoved]);

  const save = async () => {
    if (!api || !state || saving) return;

    const text = state.draft;
    setSaving(true);

    try {
      const result = await api.write(workspaceId, path, text);

      if (!result?.success) {
        setProblem(result?.error || t("canvasCouldNotOpen"));
        return;
      }

      setProblem(null);
      setState((previous) => (previous ? afterSave(previous, text) : previous));
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 1500);
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void save();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const textarea = event.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const current = textarea.value;
      const next = current.substring(0, start) + "  " + current.substring(end);
      setState((previous) => (previous ? { ...previous, draft: next } : previous));
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      });
    }
  };

  const dirty = state ? isDirty(state) : false;
  const lines = state ? lineCount(state.draft) : 1;
  const [scrollTop, setScrollTop] = useState(0);
  const lastScrollTopRef = useRef(0);

  const visibleRange = useMemo(() => {
    if (lines <= 200) {
      return { isWindowed: false, startLine: 0, endLine: lines };
    }
    const start = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - OVERSCAN);
    const end = Math.min(lines, Math.ceil((scrollTop + 800) / LINE_HEIGHT) + OVERSCAN);
    return { isWindowed: true, startLine: start, endLine: end };
  }, [lines, scrollTop]);

  const visibleText = useMemo(() => {
    if (!state) return "";
    if (!visibleRange.isWindowed) {
      return state.draft.endsWith("\n") ? `${state.draft} ` : state.draft;
    }
    const allLines = state.draft.split("\n");
    const slice = allLines.slice(visibleRange.startLine, visibleRange.endLine).join("\n");
    return slice.endsWith("\n") ? `${slice} ` : slice;
  }, [state, visibleRange]);

  const topSpacerHeight = visibleRange.startLine * LINE_HEIGHT;
  const bottomSpacerHeight = Math.max(0, (lines - visibleRange.endLine) * LINE_HEIGHT);

  return (
    <div className="flex h-full min-w-0 flex-col bg-[var(--bg-base)]">
      <div
        className="flex items-center gap-2 border-b-[3px] px-3 py-2"
        style={{ borderColor: "var(--border-light)" }}
      >
        {isImage ? (
          <ImageIcon className="h-4 w-4 flex-shrink-0 text-[var(--text-muted)]" />
        ) : (
          <FileCode className="h-4 w-4 flex-shrink-0 text-[var(--text-muted)]" />
        )}

        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              autoFocus
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setRenaming(false);
                  if (onRename && renameDraft.trim() && renameDraft !== baseName(path)) {
                    void onRename(renameDraft);
                  }
                } else if (e.key === "Escape") {
                  setRenaming(false);
                }
              }}
              onBlur={() => {
                setRenaming(false);
                if (onRename && renameDraft.trim() && renameDraft !== baseName(path)) {
                  void onRename(renameDraft);
                }
              }}
              aria-label={t("rename")}
              className="w-full rounded-lg border-2 border-[var(--border-light)] bg-[var(--bg-panel)] px-2 py-0.5 text-sm font-bold outline-none text-[var(--text-main)]"
            />
          ) : (
            <>
              <p className="truncate text-sm font-bold tracking-tight" title={path}>
                {baseName(path)}
              </p>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                {languageOf(path)}
                {imageBytes > 0 && ` · ${Math.round(imageBytes / 1024)} KB`}
                {imageDimensions && ` · ${imageDimensions.width} × ${imageDimensions.height}`}
                {dirty && ` · ${t("canvasUnsaved")}`}
              </p>
            </>
          )}
        </div>

        {onRename && !renaming && (
          <button
            onClick={() => {
              setRenameDraft(baseName(path));
              setRenaming(true);
            }}
            title={t("rename")}
            aria-label={t("rename")}
            className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)]"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}

        {allowExternal && (
          <button
            onClick={() => window.electronAPI?.openFile?.(path)}
            title={t("openFile")}
            aria-label={t("openFile")}
            className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)]"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        )}

        {onDelete &&
          (confirmDelete ? (
            <div className="flex items-center gap-1">
              <button
                onClick={async () => {
                  setConfirmDelete(false);
                  await onDelete();
                }}
                className="rounded-lg border-[2px] border-red-500 px-2 py-0.5 text-[10px] font-bold uppercase text-red-500"
              >
                {t("confirm")}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded-lg px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--text-muted)]"
              >
                {t("cancel")}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              title={t("delete")}
              aria-label={t("delete")}
              className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-red-500"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ))}

        {(isMarkdown || isSvg) && (
          <div className="flex rounded-lg border-2 border-[var(--border-light)] p-0.5 bg-[var(--bg-panel)] text-[10px] font-bold uppercase tracking-wider">
            <button
              type="button"
              onClick={() => setViewMode("edit")}
              className={`px-2 py-1 rounded-md transition-colors ${
                activeMode === "edit"
                  ? "bg-[var(--bg-inverted)] text-[var(--text-inverted)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-main)]"
              }`}
            >
              {t("edit")}
            </button>
            <button
              type="button"
              onClick={() => setViewMode("preview")}
              className={`px-2 py-1 rounded-md transition-colors ${
                activeMode === "preview"
                  ? "bg-[var(--bg-inverted)] text-[var(--text-inverted)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-main)]"
              }`}
            >
              {t("preview")}
            </button>
          </div>
        )}

        {(!isImage || isSvg) && (
          <button
            onClick={() => void save()}
            disabled={!dirty || saving}
            aria-label={t("save")}
            title={t("save")}
            className="flex items-center gap-1.5 rounded-xl border-[3px] border-[var(--border-light)] px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-main)] disabled:opacity-40"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : justSaved ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {justSaved ? t("canvasSaved") : t("save")}
          </button>
        )}

        <button
          onClick={onClose}
          aria-label={t("canvasClose")}
          title={t("canvasClose")}
          className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {state?.conflict !== null && state?.conflict !== undefined && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 border-b-[3px] bg-[var(--bg-panel)] px-3 py-2 text-xs"
          style={{ borderColor: "var(--border-light)" }}
        >
          <span className="flex-1 text-[var(--text-muted)]">{t("canvasChangedOnDisk")}</span>
          <button
            onClick={() => setState((previous) => (previous ? takeTheirs(previous) : previous))}
            className="rounded-lg px-2 py-1 font-bold hover:bg-[var(--hover-bg)]"
          >
            {t("canvasTakeTheirs")}
          </button>
          <button
            onClick={() => setState((previous) => (previous ? keepMine(previous) : previous))}
            className="rounded-lg px-2 py-1 font-bold hover:bg-[var(--hover-bg)]"
          >
            {t("canvasKeepMine")}
          </button>
        </div>
      )}

      {problem && <p className="px-3 py-2 text-xs text-red-500">{problem}</p>}

      {isImage && (!isSvg || activeMode === "preview") ? (
        <div className="relative flex flex-1 flex-col items-center justify-center overflow-auto p-4 select-none bg-[var(--bg-base)]">
          <div
            className="relative flex max-h-full max-w-full items-center justify-center rounded-lg border-2 border-[var(--border-light)] p-2 shadow-inner overflow-hidden"
            style={{
              backgroundImage:
                "linear-gradient(45deg, var(--hover-bg) 25%, transparent 25%), linear-gradient(-45deg, var(--hover-bg) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--hover-bg) 75%), linear-gradient(-45deg, transparent 75%, var(--hover-bg) 75%)",
              backgroundSize: "16px 16px",
              backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
            }}
          >
            {imageDataUrl ? (
              <img
                src={imageDataUrl}
                alt={baseName(path)}
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: "center center",
                  transition: "transform 0.15s ease-out",
                }}
                className="max-h-[70vh] max-w-full object-contain rounded"
                onLoad={(e) => {
                  setImageDimensions({
                    width: e.currentTarget.naturalWidth,
                    height: e.currentTarget.naturalHeight,
                  });
                }}
              />
            ) : (
              <Loader2 className="h-5 w-5 animate-spin text-[var(--text-muted)]" />
            )}
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-xl border-2 border-[var(--border-light)] bg-[var(--bg-panel)] px-3 py-1 text-xs font-bold text-[var(--text-muted)]">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.25, Number((z - 0.25).toFixed(2))))}
              className="hover:text-[var(--text-main)] px-1"
              title={t("zoomOut")}
              aria-label={t("zoomOut")}
            >
              -
            </button>
            <span className="min-w-[3.5rem] text-center font-mono">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(4, Number((z + 0.25).toFixed(2))))}
              className="hover:text-[var(--text-main)] px-1"
              title={t("zoomIn")}
              aria-label={t("zoomIn")}
            >
              +
            </button>
            {zoom !== 1 && (
              <button
                type="button"
                onClick={() => setZoom(1)}
                className="ml-1 text-[10px] uppercase hover:text-[var(--text-main)] underline"
              >
                {t("resetZoom")}
              </button>
            )}
          </div>
        </div>
      ) : state ? (
        activeMode === "preview" && isMarkdown ? (
          <div className="flex-1 overflow-y-auto p-6 bg-[var(--bg-base)] text-[var(--text-main)] markdown-body max-w-none">
            <ReactMarkdown
              remarkPlugins={DOCUMENT_REMARK_PLUGINS}
              rehypePlugins={REHYPE_PLUGINS}
              components={MARKDOWN_COMPONENTS}
            >
              {state.draft}
            </ReactMarkdown>
          </div>
        ) : (
          <div
            className={`flex min-h-0 flex-1 overflow-hidden font-mono text-[13px] leading-5 ${
              isCode ? "bg-[#1e1e1e]" : "bg-[var(--bg-base)] text-[var(--text-main)]"
            }`}
          >
            <pre
              ref={gutterRef}
              aria-hidden="true"
              className={`m-0 select-none overflow-hidden text-right ${
                isCode
                  ? "text-[#858585] border-r border-[#333333] bg-[#1e1e1e]"
                  : "text-[var(--text-muted)] border-r border-[var(--border-light)] bg-[var(--bg-panel)]"
              }`}
              style={{ minWidth: "3.5rem", padding: "12px 8px 12px 12px", lineHeight: `${LINE_HEIGHT}px` }}
            >
              {visibleRange.isWindowed && topSpacerHeight > 0 && (
                <div style={{ height: `${topSpacerHeight}px` }} />
              )}
              {Array.from(
                { length: visibleRange.endLine - visibleRange.startLine },
                (_, index) => visibleRange.startLine + index + 1,
              ).join("\n")}
              {visibleRange.isWindowed && bottomSpacerHeight > 0 && (
                <div style={{ height: `${bottomSpacerHeight}px` }} />
              )}
            </pre>
            <div className="relative min-w-0 flex-1 h-full overflow-hidden">
              {isCode && (
                <div
                  ref={highlighterRef}
                  aria-hidden="true"
                  className="absolute inset-0 pointer-events-none overflow-hidden m-0"
                  style={{ padding: "12px 0" }}
                >
                  {visibleRange.isWindowed && topSpacerHeight > 0 && (
                    <div style={{ height: `${topSpacerHeight}px` }} />
                  )}
                  <SyntaxHighlighter
                    language={prismLanguageOf(path) || "text"}
                    style={atomDark}
                    customStyle={{
                      margin: 0,
                      padding: "0 12px",
                      background: "transparent",
                      fontSize: "13px",
                      lineHeight: `${LINE_HEIGHT}px`,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                      whiteSpace: "pre",
                      wordBreak: "keep-all",
                      tabSize: 2,
                      overflow: "visible",
                    }}
                    codeTagProps={{
                      style: {
                        fontSize: "13px",
                        lineHeight: `${LINE_HEIGHT}px`,
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                        whiteSpace: "pre",
                        wordBreak: "keep-all",
                        tabSize: 2,
                      },
                    }}
                  >
                    {visibleText}
                  </SyntaxHighlighter>
                  {visibleRange.isWindowed && bottomSpacerHeight > 0 && (
                    <div style={{ height: `${bottomSpacerHeight}px` }} />
                  )}
                </div>
              )}
              <textarea
                ref={textareaRef}
                value={state.draft}
                onChange={(event) => {
                  const draft = event.target.value;
                  setState((previous) => (previous ? { ...previous, draft } : previous));
                }}
                onKeyDown={onKeyDown}
                onScroll={(event) => {
                  const top = event.currentTarget.scrollTop;
                  const left = event.currentTarget.scrollLeft;
                  if (highlighterRef.current) {
                    highlighterRef.current.scrollTop = top;
                    highlighterRef.current.scrollLeft = left;
                  }
                  if (gutterRef.current) {
                    gutterRef.current.scrollTop = top;
                  }
                  if (lines > 200 && Math.abs(top - lastScrollTopRef.current) > LINE_HEIGHT * 8) {
                    lastScrollTopRef.current = top;
                    setScrollTop(top);
                  }
                }}
                spellCheck={false}
                wrap="off"
                aria-label={baseName(path)}
                className={`absolute inset-0 w-full h-full resize-none bg-transparent p-3 outline-none overflow-auto border-0 text-[13px] leading-5 font-mono ${
                  isCode ? "code-editor-textarea" : "text-[var(--text-main)] caret-[var(--text-main)]"
                }`}
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                  whiteSpace: "pre",
                  wordBreak: "keep-all",
                  tabSize: 2,
                  lineHeight: `${LINE_HEIGHT}px`,
                }}
              />
            </div>
          </div>
        )
      ) : (
        !problem && (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--text-muted)]" />
          </div>
        )
      )}
    </div>
  );
}
