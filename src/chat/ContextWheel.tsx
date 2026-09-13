import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, Loader2, Minimize2 } from "lucide-react";
import { formatTokenCount } from "../agent/contextBreakdown";
import type { ContextRow, ContextWindowView } from "../agent/contextBreakdown";
import { CONTEXT_COLORS, formatPercent, toneFor } from "./contextView";

interface ContextWheelProps {
  view: ContextWindowView;
  t: (key: string) => string;
  /** Folds the older conversation into notes now. Absent when there is nothing to fold. */
  onCompact?: () => void;
  /** A fold is running in this conversation. */
  compacting?: boolean;
}

const LABEL_KEYS: Record<ContextRow["id"], string> = {
  messages: "contextMessages",
  system: "contextSystem",
  tools: "contextTools",
  memory: "contextMemory",
  skills: "contextSkills",
  summary: "contextSummary",
  draft: "contextDraft",
  free: "contextFree",
};

const SIZE = 18;
const STROKE = 2.5;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Context use as a ring beside the model picker. Opened, it breaks the window down: conversation,
 * instructions, tools, memory, and what is left. */
export default function ContextWheel({ view, t, onCompact, compacting }: ContextWheelProps) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const close = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const filled = Math.max(0, Math.min(100, view.percent));
  const tone = toneFor(view.percent);
  const summary = `${formatTokenCount(view.usedTokens)} / ${formatTokenCount(view.windowTokens)} (${formatPercent(view.percent)})`;

  const parts = view.rows.filter((row) => row.id !== "free");

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`${t("contextWindow")}: ${summary}`}
        aria-expanded={open}
        title={`${t("contextWindow")}: ${summary}`}
        className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 hover:bg-[var(--hover-bg)] transition-colors"
      >
        {compacting ? (
          <Loader2 className="w-4 h-4 animate-spin text-[var(--text-muted)]" />
        ) : (
          <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke="var(--border-light)"
              strokeWidth={STROKE}
            />
            <circle
              data-testid="context-wheel-fill"
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={tone}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE * (1 - filled / 100)}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            />
          </svg>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            key="context-panel"
            role="dialog"
            aria-label={t("contextWindow")}
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full right-0 mb-2 w-72 rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)] p-3 shadow-xl z-50 space-y-2.5"
          >
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
              className="w-full flex items-center gap-2 text-left"
            >
              <span className="flex-1 text-xs font-bold">{t("contextWindow")}</span>
              <span className="text-[11px] font-bold tabular-nums text-[var(--text-muted)]">
                {summary}
              </span>
              <ChevronRight
                className={`w-3.5 h-3.5 flex-shrink-0 text-[var(--text-muted)] transition-transform ${
                  expanded ? "rotate-90" : ""
                }`}
              />
            </button>

            <div
              className="flex h-1.5 w-full overflow-hidden rounded-full bg-[var(--hover-bg)]"
              aria-hidden="true"
            >
              {parts.map((row) => (
                <div
                  key={row.id}
                  className="h-full"
                  style={{
                    width: `${Math.max(row.percent, row.tokens > 0 ? 0.6 : 0)}%`,
                    backgroundColor: CONTEXT_COLORS[row.id],
                  }}
                />
              ))}
            </div>

            {expanded && (
              <ul className="space-y-1.5 pt-0.5">
                {view.rows.map((row) => (
                  <li key={row.id} className="flex items-center gap-2 text-[11px]">
                    <span
                      className="w-2.5 h-2.5 rounded-[3px] flex-shrink-0"
                      style={
                        row.id === "free"
                          ? { border: "2px solid var(--border-light)" }
                          : { backgroundColor: CONTEXT_COLORS[row.id] }
                      }
                    />
                    <span className="flex-1 font-bold">{t(LABEL_KEYS[row.id])}</span>
                    <span className="tabular-nums text-[var(--text-muted)]">
                      {formatTokenCount(row.tokens)}
                    </span>
                    <span className="w-11 text-right tabular-nums font-bold">
                      {formatPercent(row.percent)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <div className="h-[2px] w-full bg-[var(--border-light)]" />

            <div className="flex items-center gap-2">
              <p className="flex-1 text-[10px] leading-snug text-[var(--text-muted)]">
                {(view.compactSource === "limit"
                  ? t("compactsAtLimit")
                  : t("compactsAutomatically")
                ).replace("{count}", formatTokenCount(view.compactAtTokens))}
              </p>

              {onCompact && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onCompact();
                  }}
                  disabled={compacting}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-[var(--hover-bg)] disabled:opacity-40 transition-colors"
                >
                  <Minimize2 className="w-3 h-3" />
                  {t("compactNow")}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
