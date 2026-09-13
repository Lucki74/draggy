import { Loader2, X } from "lucide-react";
import { PULL_PHASE_KEYS } from "../ollama";
import type { PullState } from "./useModelManager";

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

  return (
    <div className="space-y-2 p-3 rounded-xl border-2 border-[var(--border-light)] bg-[var(--bg-base)]">
      <div className="flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
        <span className="text-sm font-bold truncate flex-1 min-w-0">{state.name}</span>
        <span className="text-[11px] font-bold text-[var(--text-muted)]">
          {state.phase === "downloading" ? `${percent.toFixed(0)}%` : t(PULL_PHASE_KEYS[state.phase])}
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
