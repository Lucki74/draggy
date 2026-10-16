import type { ReactNode } from "react";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/icons/Icon";

/** One option in a setup radiogroup: a hairline card, ringed in ink when it is the one chosen. */
export function Choice({
  selected,
  disabled = false,
  onSelect,
  title,
  marker,
  icon,
  large = false,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  title: ReactNode;
  /** A short word beside the title, such as "Recommended". */
  marker?: string;
  icon?: ReactNode;
  /** The main choices on a step get more room than the alternatives under them. */
  large?: boolean;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={onSelect}
      className={`flex w-full items-start gap-3 rounded-md bg-surface-base text-start outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas disabled:cursor-not-allowed disabled:opacity-50 ${
        large ? "px-5 py-4" : "px-4 py-3"
      } ${
        selected
          ? "shadow-[0_0_0_2px_var(--text-primary)]"
          : "shadow-[0_0_0_1px_var(--rule-strong)] enabled:hover:shadow-[0_0_0_1px_var(--rule-control)]"
      }`}
    >
      {icon && <span className="mt-0.5 flex-shrink-0 text-text-secondary">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className={`flex items-center gap-2 font-medium text-text-primary ${large ? "text-[15px] leading-6" : "text-[14px] leading-5"}`}>
          <span className="min-w-0 truncate">{title}</span>
          {marker && (
            <span className="flex-shrink-0 rounded-pill bg-surface-raised px-2 py-0.5 text-[11px] font-medium leading-4 text-text-secondary">
              {marker}
            </span>
          )}
        </span>
        {children && <span className="mt-1 block text-[13px] leading-5 text-text-secondary">{children}</span>}
      </span>
      <span
        aria-hidden="true"
        className={`mt-1 h-4 w-4 flex-shrink-0 rounded-full ${
          selected ? "border-[5px] border-text-primary" : "border border-rule-control"
        }`}
      />
    </button>
  );
}

/** Shown where a step needs the network and the computer has none. */
export function OfflineNotice({ onRetry, t }: { onRetry: () => void; t: (key: string) => string }) {
  return (
    <div className="flex items-center gap-3 rounded-md bg-surface-raised px-4 py-3">
      <Icon name="wifi-slash" size={16} className="flex-shrink-0 text-text-secondary" />
      <p className="min-w-0 flex-1 text-[13px] leading-5 text-text-primary">{t("onbOffline")}</p>
      <Button variant="secondary" size="dense" onClick={onRetry}>
        {t("retry")}
      </Button>
    </div>
  );
}
