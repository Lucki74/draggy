import { Clock, Loader2, X } from "lucide-react";
import { PULL_PHASE_KEYS } from "../ollama";
import type { PullState } from "./useModelManager";

/** Formats a remaining duration as `2m 05s`, or `1h 01m 05s` past an hour; empty when unknown. */
// eslint-disable-next-line react-refresh/only-export-components -- pure helper, exported so tests can reach it
export function formatRemainingTime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "";
  // Rounding first keeps a sub-second estimate from rendering as a pointless "0m 00s".
  const total = Math.round(seconds);
  if (total <= 0) return "";
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return hours > 0 ? `${hours}h ${pad(mins)}m ${pad(secs)}s` : `${mins}m ${pad(secs)}s`;
}

// A model download in flight, with its progress and, when it can be stopped, a cancel button.
export default function PullProgress({
  state,
  onCancel,
  t,
}: {
  state: PullState;
  onCancel?: () => void;
  t: (key: string) => string;
}) {
  const percent = Math.min(100, Math.max(0, state.percent));
  const timeRemaining = state.phase === "downloading" ? formatRemainingTime(state.remainingSeconds) : "";

  return (
    <div className="space-y-2 p-3 rounded-xl border-2 border-[var(--border-light)] bg-[var(--bg-base)]">
      <div className="flex items-center gap-2">
        {state.phase === "queued" ? (
          <Clock className="w-4 h-4 flex-shrink-0 text-[var(--text-muted)]" />
        ) : (
          <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
        )}
        <span className="text-sm font-bold truncate flex-1 min-w-0">{state.name}</span>
        {timeRemaining ? (
          <span className="text-[11px] font-bold text-[var(--text-muted)] flex-shrink-0">
            {timeRemaining}
          </span>
        ) : null}
        <span className="text-[11px] font-bold text-[var(--text-muted)] flex-shrink-0">
          {state.phase === "downloading"
            ? `${percent.toFixed(0)}%`
            : t(state.phase === "queued" ? "queuedDownload" : PULL_PHASE_KEYS[state.phase])}
        </span>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="p-1 text-[var(--text-muted)] hover:text-red-500 transition-colors"
            aria-label={t("cancel")}
            title={t("cancel")}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="h-2 rounded-full overflow-hidden bg-[var(--hover-bg)]">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${percent}%`, background: "var(--text-main)" }}
        />
      </div>
    </div>
  );
}
