import { useRef, useState } from "react";
import Logo from "../Logo";
import { ProviderIcon } from "../providers/ProviderIcon";
import { Button as UiButton } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { FLOAT_CLASSES, useDismiss } from "../ui/float";
import { Icon } from "../ui/icons/Icon";
import { SegmentedControl } from "../ui/SegmentedControl";

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
        <h2 className="text-[22px] font-semibold leading-8 text-text-primary">{title}</h2>
        {description && <p className="mt-1 text-[14px] leading-5 text-text-secondary">{description}</p>}
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
        <div>
          {title && (
            <h3 className={`text-[13px] font-medium leading-5 ${danger ? "text-danger" : "text-text-secondary"}`}>{title}</h3>
          )}
          {description && <p className="mt-0.5 text-[12px] leading-4 text-text-tertiary">{description}</p>}
        </div>
      )}
      <div
        className={`divide-y divide-rule rounded-md bg-surface-base ${
          danger ? "shadow-[0_0_0_1px_color-mix(in_srgb,var(--danger)_40%,transparent)]" : "shadow-[0_0_0_1px_var(--rule-strong)]"
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
    <div className="flex flex-col gap-3 px-4 py-3 sm:min-h-14 sm:flex-row sm:items-center sm:gap-6">
      <div className="min-w-0 flex-1">
        <p className="text-[14px] leading-5 text-text-primary">{label}</p>
        {description && <div className="mt-0.5 text-[13px] leading-5 text-text-secondary">{description}</div>}
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
      className={`relative h-5 w-9 flex-shrink-0 rounded-pill outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? "bg-text-primary" : "bg-rule-control"
      }`}
    >
      <span
        className={`absolute start-0.5 top-0.5 block h-4 w-4 rounded-full bg-surface-base shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-transform duration-150 ${
          checked ? "translate-x-4 rtl:-translate-x-4" : ""
        }`}
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
    <SegmentedControl
      ariaLabel={label}
      value={value}
      options={options.map((option) => ({ value: option.id, label: option.label }))}
      onChange={onChange}
    />
  );
}

export interface SelectOption {
  id: string;
  label: string;
  hint?: string;
  /** A heading shown above the first option of each run with the same group. */
  group?: string;
  /** The provider type whose logo leads the group heading; "draggy" is the local engine. */
  groupType?: string;
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
  useDismiss(open, [boxRef], () => setOpen(false));

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
        className="flex h-8 w-full items-center gap-2 rounded-sm bg-surface-base px-3 text-start text-[13px] text-text-primary shadow-[inset_0_0_0_1px_var(--rule-control)] outline-none hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-focus"
      >
        <span className="min-w-0 flex-1 truncate">{selected?.label || placeholder}</span>
        <Icon
          name="caret-down"
          size={14}
          className={`flex-shrink-0 text-text-tertiary transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div role="listbox" aria-label={label} className={`${FLOAT_CLASSES} start-0 end-0 top-full mt-1.5 max-h-64 overflow-y-auto py-1`}>
          {listed.length === 0 ? (
            <p className="px-3 py-1.5 text-text-tertiary">{placeholder}</p>
          ) : (
            listed.map((option, index) => [
              option.group && option.group !== listed[index - 1]?.group && (
                <p key={`group-${option.group}`} className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[12px] font-medium text-text-secondary">
                  {option.groupType === "draggy" ? (
                    <Logo className="w-3 h-3 flex-shrink-0 text-text-primary" />
                  ) : (
                    option.groupType && <ProviderIcon type={option.groupType} name={option.group} size="w-3 h-3" />
                  )}
                  <span className="truncate">{option.group}</span>
                </p>
              ),
              <button
                key={option.id || "automatic"}
                type="button"
                role="option"
                aria-selected={option.id === value}
                onClick={() => {
                  onChange(option.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-start outline-none hover:bg-surface-raised focus-visible:bg-surface-raised"
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.hint && <span className="flex-shrink-0 text-[12px] text-text-tertiary">{option.hint}</span>}
                <span className="w-4 flex-shrink-0">{option.id === value && <Icon name="check" size={16} />}</span>
              </button>,
            ])
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
  const variant = tone === "plain" ? "secondary" : tone;
  return (
    <UiButton variant={variant} size="dense" onClick={onClick} disabled={disabled} className="whitespace-nowrap">
      {children}
    </UiButton>
  );
}

/** A labelled field for panels that still stack their parts, like statistics. */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-[13px] font-medium leading-5 text-text-secondary">{label}</p>
      {children}
    </div>
  );
}

/** A small label beside a name: what a model can do, or where it is used. */
export function Badge({
  children,
  strong,
  title,
}: {
  children: React.ReactNode;
  strong?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`flex-shrink-0 rounded-pill px-2 py-0.5 text-[11px] font-medium leading-4 ${
        strong ? "bg-action-bg text-action-fg" : "bg-surface-raised text-text-secondary"
      }`}
    >
      {children}
    </span>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-surface-raised px-3 py-2.5">
      <p className="text-[12px] leading-4 text-text-secondary">{label}</p>
      <p className="mt-0.5 text-[18px] font-semibold leading-6 tabular-nums text-text-primary">{value}</p>
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
  tone = "danger",
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Red for what cannot be undone; the primary look for a choice that only goes ahead. */
  tone?: "danger" | "primary";
}) {
  return (
    <Dialog
      open
      onClose={onCancel}
      title={title}
      description={body}
      closeLabel={cancelLabel}
      actions={
        <>
          <UiButton variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </UiButton>
          <UiButton variant={tone} onClick={onConfirm}>
            {confirmLabel}
          </UiButton>
        </>
      }
    />
  );
}
