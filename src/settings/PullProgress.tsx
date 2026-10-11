import { Button } from "../ui/Button";
import { Icon } from "../ui/icons/Icon";
import { ProgressLine } from "../ui/ProgressLine";
import { PULL_PHASE_KEYS } from "../llama";
import { formatBytes, formatTransferred } from "../formatBytes";
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

/** What the line under the name says: the bytes and speed the engine measured, or the phase. */
function statusText(state: PullState, t: (key: string) => string): string {
  if (state.phase === "failed") return state.error || t("downloadFailed");
  if (state.phase === "queued") return t("queuedDownload");
  if (state.phase !== "downloading" || !state.total) return t(PULL_PHASE_KEYS[state.phase]);

  const parts = [`${formatTransferred(state.completed ?? 0, state.total)}`];
  if (state.bytesPerSecond) parts.push(`${formatBytes(state.bytesPerSecond)}/s`);
  const remaining = formatRemainingTime(state.remainingSeconds);
  if (remaining) parts.push(remaining);
  return parts.join(" · ");
}

/** A model download in a list: its name, a line of what it is doing, and the progress line under
 * them. A failed one offers to try again. */
export default function PullProgress({
  state,
  onCancel,
  onRetry,
  t,
}: {
  state: PullState;
  onCancel?: () => void;
  onRetry?: () => void;
  t: (key: string) => string;
}) {
  const failed = state.phase === "failed";
  const measured = state.phase === "downloading" && Boolean(state.total);
  const status = statusText(state, t);

  return (
    <div className="py-2.5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] leading-5 text-text-primary" title={state.name}>
            {state.name}
          </p>
          <p
            role={failed ? "alert" : undefined}
            className={`truncate text-[12px] leading-4 tabular-nums ${failed ? "text-danger" : "text-text-secondary"}`}
          >
            {status}
          </p>
        </div>
        {failed && onRetry && (
          <Button variant="secondary" size="dense" onClick={onRetry} icon={<Icon name="arrow-clockwise" size={14} />}>
            {t("retry")}
          </Button>
        )}
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            aria-label={t(failed ? "dismiss" : "cancel")}
            title={t(failed ? "dismiss" : "cancel")}
            className="rounded-sm p-1.5 text-text-tertiary outline-none transition-colors hover:bg-surface-raised hover:text-text-primary focus-visible:ring-2 focus-visible:ring-focus"
          >
            <Icon name="x" size={14} />
          </button>
        )}
      </div>
      {!failed && (
        <ProgressLine
          className="mt-2"
          progress={measured ? Math.min(100, Math.max(0, state.percent)) / 100 : state.phase === "queued" ? 0 : undefined}
          label={`${state.name}: ${status}`}
        />
      )}
    </div>
  );
}
