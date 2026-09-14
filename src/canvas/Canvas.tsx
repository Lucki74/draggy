import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Check, FileCode, Loader2, Save, X } from "lucide-react";
import { baseName } from "../files/tree";
import {
  afterSave,
  isDirty,
  keepMine,
  languageOf,
  lineCount,
  onDiskChange,
  openState,
  readChange,
  takeTheirs,
} from "./drafts";
import type { CanvasState, FileChange } from "./drafts";
import ReactMarkdown from "react-markdown";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-async";
import { atomDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  MARKDOWN_COMPONENTS,
  REHYPE_PLUGINS,
  REMARK_PLUGINS,
} from "../chat/markdown";

interface CanvasProps {
  workspaceId: string;
  path: string;
  t: (key: string) => string;
  onClose: () => void;
  /** The file was moved while open; the canvas follows it to its new name. */
  onMoved?: (path: string) => void;
}

/** A project file beside the chat that both the user and the model edit. Saves use the guarded
 * write, so every save is checkpointed and undoable. */
export default function Canvas({ workspaceId, path, t, onClose, onMoved }: CanvasProps) {
  const [state, setState] = useState<CanvasState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [viewMode, setViewMode] = useState<"edit" | "preview">("edit");
  const isMarkdown = path.toLowerCase().endsWith(".md") || path.toLowerCase().endsWith(".markdown");
  const gutterRef = useRef<HTMLPreElement>(null);

  const api = window.electronAPI?.files;

  // Opening, and following the file when something else changes it.
  useEffect(() => {
    if (!api) return;

    let current = true;

    const load = (apply: (text: string) => void) =>
      api.read(workspaceId, path).then((result) => {
        if (!current) return;

        if (!result?.success || typeof result.text !== "string") {
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
    }
  };

  const dirty = state ? isDirty(state) : false;
  const lines = state ? lineCount(state.draft) : 1;

  return (
    <div className="flex h-full min-w-0 flex-col bg-[var(--bg-base)]">
      <div
        className="flex items-center gap-2 border-b-[3px] px-3 py-2"
        style={{ borderColor: "var(--border-light)" }}
      >
        <FileCode className="h-4 w-4 flex-shrink-0 text-[var(--text-muted)]" />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold tracking-tight" title={path}>
            {baseName(path)}
          </p>
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
            {languageOf(path)}
            {dirty && ` · ${t("canvasUnsaved")}`}
          </p>
        </div>

        <div className="flex rounded-lg border-2 border-[var(--border-light)] p-0.5 bg-[var(--bg-panel)] text-[10px] font-bold uppercase tracking-wider">
          <button
            type="button"
            onClick={() => setViewMode("edit")}
            className={`px-2 py-1 rounded-md transition-colors ${
              viewMode === "edit"
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
              viewMode === "preview"
                ? "bg-[var(--bg-inverted)] text-[var(--text-inverted)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-main)]"
            }`}
          >
            {t("preview")}
          </button>
        </div>

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

      {state ? (
        viewMode === "preview" ? (
          isMarkdown ? (
            <div className="flex-1 overflow-y-auto p-6 bg-[var(--bg-base)] text-[var(--text-main)] prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown
                remarkPlugins={REMARK_PLUGINS}
                rehypePlugins={REHYPE_PLUGINS}
                components={MARKDOWN_COMPONENTS}
              >
                {state.draft}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="flex-1 overflow-auto bg-[#1e1e1e] font-mono text-[13px]">
              <SyntaxHighlighter
                language={languageOf(path) || "text"}
                style={atomDark}
                showLineNumbers
                customStyle={{
                  margin: 0,
                  padding: "1rem",
                  background: "transparent",
                  fontSize: "13px",
                }}
              >
                {state.draft}
              </SyntaxHighlighter>
            </div>
          )
        ) : (
          <div className="flex min-h-0 flex-1 overflow-hidden font-mono text-[13px] leading-5">
            <pre
              ref={gutterRef}
              aria-hidden="true"
              className="m-0 select-none overflow-hidden px-2 py-3 text-right text-[var(--text-muted)] opacity-60"
            >
              {Array.from({ length: lines }, (_, index) => index + 1).join("\n")}
            </pre>
            <textarea
              value={state.draft}
              onChange={(event) => {
                const draft = event.target.value;
                setState((previous) => (previous ? { ...previous, draft } : previous));
              }}
              onKeyDown={onKeyDown}
              onScroll={(event) => {
                if (gutterRef.current) {
                  gutterRef.current.scrollTop = event.currentTarget.scrollTop;
                }
              }}
              spellCheck={false}
              wrap="off"
              aria-label={baseName(path)}
              className="min-w-0 flex-1 resize-none bg-transparent px-3 py-3 text-[var(--text-main)] outline-none"
            />
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
