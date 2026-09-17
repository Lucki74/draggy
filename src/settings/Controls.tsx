import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

/** The pieces every settings page is built from: a page, grouped cards of rows, and the controls
 * that sit in a row. One look, so no page invents its own. */

export function Page({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-8 pb-12">
      <header>
        <h2 className="text-xl font-bold tracking-wide text-[var(--text-main)]">{title}</h2>
        {description && (
          <p className="mt-1 text-sm font-medium leading-relaxed text-[var(--text-muted)]">
            {description}
          </p>
        )}
      </header>
      {children}
    </div>
  );
}

/** A card of related rows under an optional heading. */
export function Group({
  title,
  description,
  danger,
  children,
}: {
  title?: string;
  description?: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      {(title || description) && (
        <div className="px-1">
          {title && (
            <h3
              className={`text-[11px] font-bold uppercase tracking-wider ${
                danger ? "text-red-500" : "text-[var(--text-muted)]"
              }`}
            >
              {title}
            </h3>
          )}
          {description && (
            <p className="mt-0.5 text-xs font-medium text-[var(--text-muted)]">{description}</p>
          )}
        </div>
      )}
      <div
        className={`rounded-xl border-[3px] bg-[var(--bg-panel)] divide-y-2 divide-[var(--border-light)] ${
          danger ? "border-red-500/40" : "border-[var(--border-light)]"
        }`}
      >
        {children}
      </div>
    </section>
  );
}

/** One setting: what it is on the left, its control on the right. */
export function Row({
  label,
  description,
  children,
}: {
  label: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-6">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-[var(--text-main)]">{label}</p>
        {description && (
          <div className="mt-0.5 text-xs font-medium leading-relaxed text-[var(--text-muted)]">
            {description}
          </div>
        )}
      </div>
      {children !== undefined && <div className="flex-shrink-0 sm:max-w-[60%]">{children}</div>}
    </div>
  );
}

/** Content that needs the card's whole width, like a list or an editor. */
export function Block({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-4">{children}</div>;
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="w-12 h-7 flex-shrink-0 rounded-full p-[3px] border-[3px] border-[var(--border-light)] transition-colors disabled:opacity-40"
      style={{ backgroundColor: checked ? "var(--bg-inverted)" : "var(--hover-bg)" }}
    >
      <span
        className={`block w-[14px] h-[14px] rounded-full transition-transform ${
          checked ? "translate-x-5" : ""
        }`}
        style={{ backgroundColor: checked ? "var(--text-inverted)" : "var(--text-muted)" }}
      />
    </button>
  );
}

/** A choice of a few, shown all at once. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-base)] p-[3px]"
    >
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors ${
              selected
                ? "bg-[var(--bg-inverted)] text-[var(--text-inverted)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-main)]"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export interface SelectOption {
  id: string;
  label: string;
  hint?: string;
}

/** A choice of many, in a menu. A value missing from the options is still shown, or a removed
 * model would be swapped silently the moment this renders. */
export function Select({
  value,
  options,
  onChange,
  label,
  placeholder = "–",
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onDown = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const listed =
    value && !options.some((option) => option.id === value)
      ? [{ id: value, label: value }, ...options]
      : options;
  const selected = listed.find((option) => option.id === value);

  return (
    <div className="relative w-full sm:w-64" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        className="w-full px-3 py-2 ui-input text-sm font-bold flex items-center gap-2 text-left"
      >
        <span className="flex-1 min-w-0 truncate">{selected?.label || placeholder}</span>
        <ChevronDown
          className={`w-4 h-4 flex-shrink-0 text-[var(--text-muted)] transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={label}
          className="absolute top-full left-0 right-0 mt-1 z-50 ui-box p-1 flex flex-col gap-0.5 max-h-64 overflow-y-auto"
        >
          {listed.length === 0 ? (
            <p className="px-2 py-1.5 text-xs font-bold text-[var(--text-muted)]">{placeholder}</p>
          ) : (
            listed.map((option) => (
              <button
                key={option.id || "automatic"}
                type="button"
                role="option"
                aria-selected={option.id === value}
                onClick={() => {
                  onChange(option.id);
                  setOpen(false);
                }}
                className={`flex items-center gap-2 px-2 py-2 rounded-lg text-left transition-colors ${
                  option.id === value
                    ? "bg-[var(--bg-inverted)] text-[var(--text-inverted)]"
                    : "hover:bg-[var(--hover-bg)]"
                }`}
              >
                <span className="flex-1 min-w-0 truncate text-xs font-bold">{option.label}</span>
                {option.hint && (
                  <span className="text-[10px] font-medium opacity-60 flex-shrink-0">
                    {option.hint}
                  </span>
                )}
                {option.id === value && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function Button({
  onClick,
  children,
  tone = "plain",
  disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  tone?: "plain" | "primary" | "danger";
  disabled?: boolean;
}) {
  const look =
    tone === "primary"
      ? "bg-[var(--bg-inverted)] text-[var(--text-inverted)] hover:opacity-90"
      : tone === "danger"
        ? "border-2 border-red-500 text-red-500 hover:bg-red-500 hover:text-white"
        : "border-2 border-[var(--border-light)] text-[var(--text-main)] hover:bg-[var(--hover-bg)]";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${look}`}
    >
      {children}
    </button>
  );
}

/** A labelled field for panels that still stack their parts, like statistics. */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
      {children}
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)]">
      <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </p>
      <p className="text-lg font-bold tabular-nums">{value}</p>
    </div>
  );
}

/** Asks before something that cannot be undone. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="mx-4 w-full max-w-md rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)] p-6 shadow-2xl">
        <h3 className="text-lg font-bold text-[var(--text-main)]">{title}</h3>
        <p className="mt-2 text-sm font-medium leading-relaxed text-[var(--text-muted)]">{body}</p>
        <div className="mt-6 flex justify-end gap-3">
          <Button onClick={onCancel}>{cancelLabel}</Button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-red-500 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-red-600"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
