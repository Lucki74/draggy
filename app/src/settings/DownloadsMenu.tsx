import { useRef, useState } from "react";
import { FLOAT_CLASSES, useDismiss } from "../ui/float";
import { Icon } from "../ui/icons/Icon";
import PullProgress from "./PullProgress";
import { isActivePull, type PullState } from "./useModelManager";

/** What the badge shows: a single digit fits the circle, so anything past nine reads as `9+`. */
// eslint-disable-next-line react-refresh/only-export-components -- pure helper, exported so tests can reach it
export function badgeLabel(count: number): string {
  return count > 9 ? "9+" : String(count);
}

/** A download button whose badge counts the models on their way, and whose panel lists each with its
 * progress and a way to stop it, or to try again once one has failed. Downloads keep going with the
 * panel closed. */
export default function DownloadsMenu({
  pulls,
  onCancel,
  onRetry,
  t,
}: {
  pulls: PullState[];
  onCancel: (name: string) => void;
  onRetry?: (name: string) => void;
  t: (key: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useDismiss(open, [rootRef], () => setOpen(false));

  const count = pulls.filter(isActivePull).length;
  const failed = pulls.length > count;
  const label = count > 0 ? `${t("downloads")} (${count})` : t("downloads");

  return (
    <div ref={rootRef} className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={label}
        className="relative grid h-8 w-8 place-items-center rounded-sm text-text-secondary shadow-[inset_0_0_0_1px_var(--rule-control)] outline-none transition-colors hover:bg-surface-raised hover:text-text-primary focus-visible:ring-2 focus-visible:ring-focus"
      >
        <Icon name="download-simple" size={16} />
        {(count > 0 || failed) && (
          <span
            data-testid="downloads-badge"
            aria-hidden="true"
            className={`absolute -end-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-pill px-1 text-[10px] font-medium leading-none tabular-nums ring-2 ring-surface-base ${
              failed ? "bg-danger text-white" : "bg-action-bg text-action-fg"
            }`}
          >
            {count > 0 ? badgeLabel(count) : "!"}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t("downloads")}
          className={`${FLOAT_CLASSES} end-0 top-full mt-1.5 max-h-[360px] w-[min(380px,calc(100vw-3rem))] overflow-y-auto px-3 py-2`}
        >
          <p className="pb-1 text-[12px] font-medium text-text-secondary">{t("downloads")}</p>
          {pulls.length === 0 ? (
            <p className="py-2 text-[13px] text-text-tertiary">{t("noDownloads")}</p>
          ) : (
            <div className="divide-y divide-rule">
              {pulls.map((pull) => (
                <PullProgress
                  key={pull.name}
                  state={pull}
                  onCancel={() => onCancel(pull.name)}
                  onRetry={onRetry && (() => onRetry(pull.name))}
                  t={t}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
