import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Icon } from "../ui/icons/Icon";

import { Menu } from "../ui/Menu";
import type { MenuEntry } from "../ui/Menu";
import { baseName } from "../files/tree";
import { ConfirmDialog } from "../settings/Controls";
import {
  afterSave,
  isCodeFile,
  isDirty,
  isHtmlFile,
  isImageFile,
  isMarkdownFile,
  isMediaFile,
  isPdfFile,
  keepMine,
  onDiskChange,
  openState,
  prismLanguageOf,
  readChange,
  takeTheirs,
} from "./drafts";
import type { CanvasState, FileChange } from "./drafts";
import ReactMarkdown from "react-markdown";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-async";
import { SYNTAX_THEME } from "../chat/syntaxTheme";
import {
  DOCUMENT_REMARK_PLUGINS,
  MARKDOWN_COMPONENTS,
  REHYPE_PLUGINS,
} from "../chat/markdown";

const LINE_HEIGHT = 20;
const AUTOSAVE_MS = 800;
const CODE_FONT = {
  fontSize: "13px",
  lineHeight: `${LINE_HEIGHT}px`,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  tabSize: 2,
} as const;
const WRAP_STYLE = { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } as const;

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
  onOpenBrowser?: (url: string) => void;
}

/** A project file beside the chat that both the user and the model edit. Saves use the guarded
 * write, so every save is checkpointed and undoable. */
export default function Canvas({
  workspaceId,
  path,
  t,
  onMoved,
  onDelete,
  onRename,
  allowExternal = true,
  onOpenBrowser,
}: CanvasProps) {
  const [state, setState] = useState<CanvasState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [viewMode, setViewMode] = useState<"edit" | "preview">("edit");
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isMarkdown = isMarkdownFile(path);
  const isImage = isImageFile(path);
  const isSvg = path.toLowerCase().endsWith(".svg");
  const isPdf = isPdfFile(path);
  const isMedia = isMediaFile(path);
  const isHtml = isHtmlFile(path);
  const isCode = isCodeFile(path);
  const activeMode = isMarkdown || isSvg ? viewMode : "edit";

  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [, setImageDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [, setImageBytes] = useState<number>(0);
  const [zoom, setZoom] = useState<number>(1);

  const scrollRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const api = window.electronAPI?.files;

  // Opening, and following the file when something else changes it.
  useEffect(() => {
    // A PDF is not read: the app's CSP allows no frame to show it in, so the pane offers the system viewer.
    if (!api || isPdfFile(path)) return;

    let current = true;

    const load = (apply: (text: string) => void) =>
      api.read(workspaceId, path).then((result) => {
        if (!current) return;

        if (!result?.success) {
          setProblem(result?.error || t("canvasCouldNotOpen"));
          return;
        }

        if (result.isImage || result.isMedia || isImageFile(path)) {
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
  const [lineHeights, setLineHeights] = useState<number[]>([]);

  // Long lines wrap, so a line number sits beside the first row of its line and the gutter takes
  // each line's height from a hidden copy of the text laid out at the same width.
  useLayoutEffect(() => {
    const mirror = mirrorRef.current;
    if (!mirror) return;
    const measure = () => {
      const next = Array.from(mirror.children, (child) => (child as HTMLElement).offsetHeight || LINE_HEIGHT);
      setLineHeights((previous) =>
        previous.length === next.length && previous.every((h, i) => h === next[i]) ? previous : next,
      );
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(mirror);
    return () => observer?.disconnect();
  }, [state?.draft, activeMode, isPdf, isMedia, isImage]);

  // Saving is automatic: a pause in typing writes the file. A change that landed on disk meanwhile
  // is left for the user to settle first.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  const canAutosave = dirty && state?.conflict === null && !saving;
  useEffect(() => {
    if (!canAutosave) return;
    const timer = window.setTimeout(() => void saveRef.current(), AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [canAutosave, state?.draft]);

  const menuItems: MenuEntry[] = [
    ...(isMarkdown || isSvg
      ? ([
          {
            id: "edit",
            label: t("edit"),
            checked: activeMode === "edit",
            onSelect: () => setViewMode("edit"),
          },
          {
            id: "preview",
            label: t("preview"),
            checked: activeMode === "preview",
            onSelect: () => setViewMode("preview"),
          },
          { type: "separator", id: "sep-view" },
        ] as MenuEntry[])
      : []),
    ...(isHtml
      ? [
          {
            id: "browser",
            label: t("openInBrowser"),
            icon: <Icon name="globe-simple" size={16} />,
            onSelect: () => {
              if (onOpenBrowser) onOpenBrowser(path);
              else void window.electronAPI?.files?.open?.(workspaceId, path);
            },
          } as MenuEntry,
        ]
      : []),
    ...(allowExternal
      ? [
          {
            id: "open",
            label: t("openFile"),
            icon: <Icon name="arrow-square-out" size={16} />,
            onSelect: () => void window.electronAPI?.openFile?.(path),
          } as MenuEntry,
        ]
      : []),
    ...(onRename
      ? [
          {
            id: "rename",
            label: t("rename"),
            icon: <Icon name="pencil-simple" size={16} />,
            onSelect: () => {
              setRenameDraft(baseName(path));
              setRenaming(true);
            },
          } as MenuEntry,
        ]
      : []),
    ...(onDelete
      ? [
          {
            id: "delete",
            label: t("delete"),
            icon: <Icon name="trash" size={16} />,
            danger: true,
            onSelect: () => setConfirmDelete(true),
          } as MenuEntry,
        ]
      : []),
  ];

  const commitRename = () => {
    setRenaming(false);
    if (onRename && renameDraft.trim() && renameDraft !== baseName(path)) {
      void onRename(renameDraft);
    }
  };

  return (
    <div dir="ltr" className="relative flex h-full min-w-0 flex-col bg-[var(--bg-base)]">
      <div className="absolute right-3 top-2 z-10">
        <Menu
          label={t("more")}
          align="end"
          items={menuItems}
          trigger={(props) => (
            <button
              type="button"
              {...props}
              title={t("more")}
              aria-label={t("more")}
              className="rounded-lg bg-transparent p-1.5 text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)]"
            >
              <Icon name="dots-three" size={16} />
            </button>
          )}
        />
      </div>

      {renaming && (
        <div className="absolute left-3 top-2 z-10 w-56">
          <input
            autoFocus
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              else if (e.key === "Escape") setRenaming(false);
            }}
            onBlur={commitRename}
            aria-label={t("rename")}
            className="w-full rounded-lg border-2 border-[var(--border-light)] bg-[var(--bg-panel)] px-2 py-0.5 text-sm font-medium outline-none text-text-primary"
          />
        </div>
      )}

      {onDelete && confirmDelete && (
        <ConfirmDialog
          title={t("deleteFileTitle").replace("{name}", baseName(path))}
          body={t("deleteFileBody")}
          confirmLabel={t("delete")}
          cancelLabel={t("cancel")}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            void onDelete();
          }}
        />
      )}

      {state?.conflict !== null && state?.conflict !== undefined && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 border-b border-rule bg-surface-raised px-3 py-2 text-xs"
        >
          <span className="flex-1 text-[var(--text-muted)]">{t("canvasChangedOnDisk")}</span>
          <button
            onClick={() => setState((previous) => (previous ? takeTheirs(previous) : previous))}
            className="rounded-lg px-2 py-1 font-medium hover:bg-surface-raised"
          >
            {t("canvasTakeTheirs")}
          </button>
          <button
            onClick={() => setState((previous) => (previous ? keepMine(previous) : previous))}
            className="rounded-lg px-2 py-1 font-medium hover:bg-surface-raised"
          >
            {t("canvasKeepMine")}
          </button>
        </div>
      )}

      {problem && <p className="px-3 py-2 text-xs text-danger">{problem}</p>}

      {isPdf ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 bg-surface-base text-text-secondary">
          <Icon name="file-text" size={32} className="text-text-tertiary" />
          <span className="text-xs">{baseName(path)}</span>
          <button
            type="button"
            onClick={() => void window.electronAPI?.files?.open?.(workspaceId, path)}
            className="rounded-sm border border-rule-control px-3 h-7 text-xs text-text-primary hover:bg-surface-raised cursor-pointer"
          >
            {t("openInEditor")}
          </button>
        </div>
      ) : isMedia ? (
        <div className="flex flex-1 items-center justify-center p-6 bg-surface-base">
          {!imageDataUrl ? (
            !problem && <Icon name="circle-notch" size={20} className="animate-spin text-text-tertiary" />
          ) : /\.(mp4|webm|mov)$/i.test(path) ? (
            <video controls src={imageDataUrl} className="max-w-full max-h-full rounded-sm" />
          ) : (
            <audio controls src={imageDataUrl} className="w-80 max-w-full" />
          )}
        </div>
      ) : isImage && (!isSvg || activeMode === "preview") ? (
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
              <Icon name="circle-notch" size={20} className="animate-spin text-[var(--text-muted)]" />
            )}
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-rule bg-surface-base px-3 py-1 text-xs font-medium text-text-secondary">
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
                className="ml-1 text-[11px] hover:text-text-primary underline"
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
            ref={scrollRef}
            className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden font-mono text-[13px] leading-5 ${
              isCode ? "bg-surface-base text-text-primary" : "bg-[var(--bg-base)] text-[var(--text-main)]"
            }`}
          >
            <div className="flex min-h-full items-stretch">
              <div
                aria-hidden="true"
                className={`flex-shrink-0 select-none text-right ${
                  isCode
                    ? "text-text-tertiary border-r border-rule bg-surface-canvas"
                    : "text-[var(--text-muted)] border-r border-[var(--border-light)] bg-[var(--bg-panel)]"
                }`}
                style={{ minWidth: "3.5rem", padding: "12px 8px 12px 12px" }}
              >
                {lineHeights.map((height, index) => (
                  <div key={index} style={{ height: `${height}px`, lineHeight: `${LINE_HEIGHT}px` }}>
                    {index + 1}
                  </div>
                ))}
              </div>
              <div ref={codeRef} className="relative min-w-0 flex-1">
                <div
                  ref={mirrorRef}
                  aria-hidden="true"
                  className={`pointer-events-none invisible ${isCode ? "absolute inset-x-0 top-0" : ""}`}
                  style={{ ...WRAP_STYLE, padding: "12px" }}
                >
                  {state.draft.split("\n").map((line, index) => (
                    <div key={index}>{line || "\u200b"}</div>
                  ))}
                </div>
                {isCode && (
                  <div aria-hidden="true" className="pointer-events-none m-0">
                    <SyntaxHighlighter
                      language={prismLanguageOf(path) || "text"}
                      style={SYNTAX_THEME}
                      customStyle={{
                        ...CODE_FONT,
                        ...WRAP_STYLE,
                        margin: 0,
                        padding: "12px",
                        background: "transparent",
                        overflow: "visible",
                      }}
                      codeTagProps={{ style: { ...CODE_FONT, ...WRAP_STYLE } }}
                    >
                      {state.draft.endsWith("\n") ? `${state.draft} ` : state.draft}
                    </SyntaxHighlighter>
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
                  spellCheck={false}
                  wrap="soft"
                  aria-label={baseName(path)}
                  className={`absolute inset-0 h-full w-full resize-none overflow-hidden border-0 bg-transparent p-3 text-[13px] leading-5 font-mono outline-none ${
                    isCode ? "code-editor-textarea" : "text-[var(--text-main)] caret-[var(--text-main)]"
                  }`}
                  style={{ ...CODE_FONT, ...WRAP_STYLE }}
                />
              </div>
            </div>
          </div>
        )
      ) : (
        !problem && (
          <div className="flex flex-1 items-center justify-center">
            <Icon name="circle-notch" size={20} className="animate-spin text-[var(--text-muted)]" />
          </div>
        )
      )}
    </div>
  );
}
