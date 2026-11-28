import { Icon } from "./icons/Icon";

/** A styled checkbox over a real, visually hidden input, so Space, focus and form semantics stay native. */
export function Checkbox({
  checked,
  onChange,
  disabled,
  label,
  className = "",
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  /** Accessible name when no visible label wraps the box. */
  label?: string;
  className?: string;
}) {
  return (
    <span className={`relative inline-flex h-4 w-4 flex-shrink-0 ${className}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => !disabled && onChange(event.target.checked)}
        className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer appearance-none rounded-[4px] opacity-0 outline-none disabled:cursor-not-allowed"
      />
      <span
        aria-hidden="true"
        className={`pointer-events-none flex h-4 w-4 items-center justify-center rounded-[4px] text-surface-base transition-colors duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-focus peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface-base ${
          checked ? "bg-accent-ink" : "bg-surface-canvas shadow-[inset_0_0_0_1px_var(--rule-control)]"
        } ${disabled ? "opacity-40" : ""}`}
      >
        {checked && <Icon name="check" size={12} />}
      </span>
    </span>
  );
}
