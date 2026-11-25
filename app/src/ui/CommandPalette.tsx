import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "./icons/Icon";
import { Kbd } from "./Kbd";
import { registerOverlay, wholeWindow } from "./overlays";

export interface PaletteItem {
  id: string;
  label: string;
  category: string;
  hint?: string;
  icon?: IconName;
  shortcut?: string;
  onSelect: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  items: PaletteItem[];
  initialQuery?: string;
  t: (key: string) => string;
}

/** Floating command palette with fuzzy search across sessions, panes, and actions.
 * Traps navigation keys, uses level 1 elevation, and registers window overlay. */
export function CommandPalette({ open, onClose, items, initialQuery = "", t }: CommandPaletteProps) {
  const [query, setQuery] = useState(initialQuery);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevQuery, setPrevQuery] = useState(query);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  // Reset query and selected index on visibility change during render.
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setQuery(initialQuery);
      setSelectedIndex(0);
    }
  }

  // Reset selection index when search query changes during render.
  if (query !== prevQuery) {
    setPrevQuery(query);
    setSelectedIndex(0);
  }

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 10);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    return registerOverlay(wholeWindow);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    const words = q.split(/\s+/);
    return items.filter((item) => {
      const text = `${item.category} ${item.label} ${item.hint || ""}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
  }, [items, query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (filtered.length ? (prev + 1) % filtered.length : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (filtered.length ? (prev - 1 + filtered.length) % filtered.length : 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const active = filtered[selectedIndex];
        if (active) {
          active.onSelect();
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, filtered, selectedIndex, onClose]);

  // Scroll active item into view.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
    active?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 bg-[var(--scrim)] fade-in" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-[560px] rounded-lg bg-surface-base shadow-elev-1 border border-rule overflow-hidden outline-none float-in"
      >
        <span id={titleId} className="sr-only">
          {t("commandPalette")}
        </span>
        <div className="flex items-center gap-2.5 px-3.5 py-3 border-b border-rule">
          <Icon name="magnifying-glass" size={16} className="text-text-tertiary flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("commandPalettePlaceholder")}
            aria-label={t("commandPalettePlaceholder")}
            className="w-full bg-transparent text-[14px] leading-5 text-text-primary placeholder:text-text-tertiary outline-none"
          />
          <Kbd>Esc</Kbd>
        </div>

        <div ref={listRef} className="max-h-[380px] overflow-y-auto p-1.5 divide-y divide-rule/40">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-[13px] text-text-secondary">{t("noCommandsFound")}</p>
          ) : (
            filtered.map((item, index) => {
              const isSelected = index === selectedIndex;
              const prev = filtered[index - 1];
              const showCategory = !prev || prev.category !== item.category;

              return (
                <div key={item.id}>
                  {showCategory && (
                    <div className="px-2.5 pt-2 pb-1 text-[11px] font-medium text-text-tertiary">
                      {item.category}
                    </div>
                  )}
                  <div
                    data-index={index}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      item.onSelect();
                      onClose();
                    }}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={`flex items-center justify-between gap-3 px-2.5 py-2 rounded-sm cursor-pointer text-[13px] leading-5 transition-colors ${
                      isSelected ? "bg-surface-raised text-text-primary" : "text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {item.icon && <Icon name={item.icon} size={16} className="text-text-tertiary flex-shrink-0" />}
                      <span className="truncate font-medium">{item.label}</span>
                      {item.hint && <span className="truncate text-[12px] text-text-tertiary">{item.hint}</span>}
                    </div>
                    {item.shortcut && <Kbd>{item.shortcut}</Kbd>}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
