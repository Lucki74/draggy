import React, { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../ui/icons/Icon";
import { IconButton } from "../ui/IconButton";
import { FLOAT_CLASSES, useDismiss } from "../ui/float";
import type { GroupBy, SortBy } from "./sessionView";

interface Option<T extends string> {
  value: T;
  label: string;
}

interface Props {
  groupBy: GroupBy;
  sortBy: SortBy;
  onGroupBy: (next: GroupBy) => void;
  onSortBy: (next: SortBy) => void;
  t: (key: string) => string;
}

/** The sidebar's view options: one button opening Group by and Sort by, each with its choices in a
 * flyout beside the row. */
export function SessionViewMenu({ groupBy, sortBy, onGroupBy, onSortBy, t }: Props) {
  const [open, setOpen] = useState(false);
  const [flyout, setFlyout] = useState<"group" | "sort" | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const id = useId();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    setFlyout(null);
  };

  useDismiss(open, [anchorRef, panelRef, flyoutRef], (reason) => {
    close();
    if (reason === "escape") anchorRef.current?.focus();
  });

  const groupOptions: Option<GroupBy>[] = [
    { value: "date", label: t("groupDate") },
    { value: "folder", label: t("groupFolder") },
    { value: "status", label: t("groupStatus") },
    { value: "custom", label: t("groupCustom") },
    { value: "none", label: t("groupNone") },
  ];
  const sortOptions: Option<SortBy>[] = [
    { value: "activity", label: t("sortActivity") },
    { value: "title", label: t("sortTitle") },
  ];

  const show = (which: "group" | "sort", row: HTMLElement) => {
    setFlyout(which);
    setRect(row.getBoundingClientRect());
  };

  const rows = [
    { key: "group" as const, label: t("groupBy"), current: groupOptions.find((o) => o.value === groupBy)?.label },
    { key: "sort" as const, label: t("sortBy"), current: sortOptions.find((o) => o.value === sortBy)?.label },
  ];

  return (
    <div className="relative inline-flex">
      <IconButton
        ref={anchorRef}
        name="sliders-horizontal"
        label={t("viewOptions")}
        size="sm"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? id : undefined}
        onClick={() => (open ? close() : setOpen(true))}
      />
      {open && (
        <div
          ref={panelRef}
          id={id}
          role="menu"
          aria-label={t("viewOptions")}
          className={`${FLOAT_CLASSES} end-0 top-full mt-1.5 w-56 py-1`}
        >
          {rows.map((row) => (
            <button
              key={row.key}
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={flyout === row.key}
              onMouseEnter={(e) => show(row.key, e.currentTarget)}
              onFocus={(e) => show(row.key, e.currentTarget)}
              onClick={(e) => show(row.key, e.currentTarget)}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-start outline-none hover:bg-surface-raised focus-visible:bg-surface-raised ${
                flyout === row.key ? "bg-surface-raised" : ""
              }`}
            >
              <span className="flex-1 min-w-0 truncate">{row.label}</span>
              <span className="text-text-secondary truncate max-w-24">{row.current}</span>
              <Icon name="caret-right" size={12} className="shrink-0 text-text-tertiary" />
            </button>
          ))}
        </div>
      )}
      {open &&
        flyout &&
        rect &&
        createPortal(
          <div
            ref={flyoutRef}
            role="menu"
            aria-label={flyout === "group" ? t("groupBy") : t("sortBy")}
            style={{ position: "fixed", top: rect.top - 4, left: rect.right + 6 }}
            className={`${FLOAT_CLASSES} !fixed w-48 py-1`}
          >
            {(flyout === "group" ? groupOptions : sortOptions).map((option, index) => {
              const checked = flyout === "group" ? option.value === groupBy : option.value === sortBy;
              return (
                <React.Fragment key={option.value}>
                  {flyout === "group" && index === groupOptions.length - 1 && (
                    <div role="separator" className="my-1 border-t border-rule" />
                  )}
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={checked}
                    onClick={() => {
                      if (flyout === "group") onGroupBy(option.value as GroupBy);
                      else onSortBy(option.value as SortBy);
                      close();
                      anchorRef.current?.focus();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-start outline-none hover:bg-surface-raised focus-visible:bg-surface-raised"
                  >
                    <span className="flex-1 min-w-0 truncate">{option.label}</span>
                    <span className="w-4 shrink-0">{checked && <Icon name="check" size={16} />}</span>
                  </button>
                </React.Fragment>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
