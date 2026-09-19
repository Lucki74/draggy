import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import PullProgress from "./PullProgress";
import type { PullState } from "./useModelManager";

/** What the badge shows: a single digit fits the circle, so anything past nine reads as `9+`. */
// eslint-disable-next-line react-refresh/only-export-components -- pure helper, exported so tests can reach it
export function badgeLabel(count: number): string {
  return count > 9 ? "9+" : String(count);
}

/** A download button whose badge counts the models on their way, and whose panel lists each with its
 * progress and a way to stop it. Downloads keep going with the panel closed. */
export default function DownloadsMenu({
  pulls,
  onCancel,
  t,
}: {
  pulls: PullState[];
  onCancel: (name: string) => void;
  t: (key: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const count = pulls.length;

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

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
        className="relative p-2.5 rounded-xl border-2 border-[var(--border-light)] bg-[var(--bg-base)] text-[var(--text-main)] hover:bg-[var(--hover-bg)] transition-colors"
      >
        <Download className="w-4 h-4" />
        {count > 0 && (
          <span
            data-testid="downloads-badge"
            aria-hidden="true"
            className="absolute -bottom-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none flex items-center justify-center ring-2 ring-[var(--bg-base)]"
          >
            {badgeLabel(count)}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t("downloads")}
          className="absolute right-0 top-full mt-2 z-20 w-[min(380px,calc(100vw-3rem))] max-h-[360px] overflow-y-auto p-3 space-y-2 rounded-xl border-2 border-[var(--border-light)] bg-[var(--bg-base)] shadow-lg"
        >
          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{t("downloads")}</p>
          {count === 0 ? (
            <p className="py-2 text-sm font-bold text-[var(--text-muted)]">{t("noDownloads")}</p>
          ) : (
            pulls.map((pull) => <PullProgress key={pull.name} state={pull} onCancel={() => onCancel(pull.name)} t={t} />)
          )}
        </div>
      )}
    </div>
  );
}
