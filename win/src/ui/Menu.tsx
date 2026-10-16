import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { Icon } from "./icons/Icon";
import { Kbd } from "./Kbd";
import { FLOAT_CLASSES, floatPosition, useDismiss, type PopoverAlign, type PopoverSide } from "./float";
import type { TriggerProps } from "./Popover";

export type MenuEntry =
    | {
          type?: "item";
          id: string;
          label: React.ReactNode;
          /** One line under the label, for choices that need explaining (permission modes). */
          description?: React.ReactNode;
          icon?: React.ReactNode;
          shortcut?: string;
          /** Set for a choice in a group: renders a check and `menuitemradio`. */
          checked?: boolean;
          /** An on/off setting rather than a choice in a group: `menuitemcheckbox`. */
          toggle?: boolean;
          danger?: boolean;
          disabled?: boolean;
          /** Why the item is disabled, or extra detail on hover. */
          title?: string;
          onSelect: () => void;
      }
    | { type: "separator"; id: string }
    | { type: "heading"; id: string; label: React.ReactNode };

export interface MenuProps {
    trigger: (props: TriggerProps) => React.ReactNode;
    items: MenuEntry[];
    label: string;
    align?: PopoverAlign;
    side?: PopoverSide;
    className?: string;
    /** Lets a keyboard shortcut elsewhere open the menu. */
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}

type Item = Extract<MenuEntry, { onSelect: () => void }>;
const isItem = (entry: MenuEntry): entry is Item => entry.type === undefined || entry.type === "item";

/** A list of actions or choices anchored to a trigger. Arrow keys move, Enter picks, digits 1 to 9
 * pick by position as in Claude Code's menus, Escape closes and returns focus to the trigger. */
export function Menu({ trigger, items, label, align = "start", side = "bottom", className = "", open: controlled, onOpenChange }: MenuProps) {
    const [own, setOwn] = useState(false);
    const open = controlled ?? own;
    const id = useId();
    const anchorRef = useRef<HTMLButtonElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const [active, setActive] = useState(0);

    const enabled = items.filter(isItem).filter((item) => !item.disabled);

    const setOpen = useCallback(
        (next: boolean) => {
            if (controlled === undefined) setOwn(next);
            onOpenChange?.(next);
        },
        [controlled, onOpenChange],
    );

    useDismiss(open, [anchorRef, listRef], (reason) => {
        setOpen(false);
        if (reason === "escape") anchorRef.current?.focus();
    });

    // Opening lands on the checked choice when there is one, otherwise the first item. A ticked
    // setting is not a choice, so it does not pull focus.
    const [seenOpen, setSeenOpen] = useState(open);
    if (open !== seenOpen) {
        setSeenOpen(open);
        if (open) setActive(Math.max(0, enabled.findIndex((item) => item.checked && !item.toggle)));
    }

    useEffect(() => {
        if (!open) return;
        const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
        node?.focus();
    }, [open, active]);

    const pick = (item: Item) => {
        setOpen(false);
        anchorRef.current?.focus();
        item.onSelect();
    };

    const onKeyDown = (event: React.KeyboardEvent) => {
        const count = enabled.length;
        if (!count) return;
        if (event.key === "ArrowDown") setActive((i) => (i + 1) % count);
        else if (event.key === "ArrowUp") setActive((i) => (i - 1 + count) % count);
        else if (event.key === "Home") setActive(0);
        else if (event.key === "End") setActive(count - 1);
        else if (event.key === "Tab") {
            setOpen(false);
            return;
        } else if (/^[1-9]$/.test(event.key) && Number(event.key) <= count) pick(enabled[Number(event.key) - 1]);
        else return;
        event.preventDefault();
    };

    let index = -1;

    return (
        <div className="relative inline-flex min-w-0">
            {trigger({
                ref: anchorRef,
                onClick: () => setOpen(!open),
                "aria-expanded": open,
                "aria-haspopup": "menu",
                "aria-controls": open ? id : undefined,
            })}
            {open && (
                <div
                    ref={listRef}
                    id={id}
                    role="menu"
                    aria-label={label}
                    onKeyDown={onKeyDown}
                    className={`${FLOAT_CLASSES} ${floatPosition(align, side)} py-1 max-h-96 overflow-y-auto ${className}`}
                >
                    {items.map((entry) => {
                        if (entry.type === "separator") return <div key={entry.id} role="separator" className="my-1 border-t border-rule" />;
                        if (entry.type === "heading")
                            return (
                                <div key={entry.id} role="presentation" className="px-3 pt-2 pb-1 text-[12px] font-medium text-text-secondary">
                                    {entry.label}
                                </div>
                            );
                        const item = entry as Item;
                        const position = item.disabled ? -1 : ++index;
                        const radio = item.checked !== undefined;
                        return (
                            <button
                                key={item.id}
                                type="button"
                                role={radio ? (item.toggle ? "menuitemcheckbox" : "menuitemradio") : "menuitem"}
                                aria-checked={radio ? item.checked : undefined}
                                aria-disabled={item.disabled || undefined}
                                title={item.title}
                                data-index={position}
                                tabIndex={position === active ? 0 : -1}
                                onClick={() => !item.disabled && pick(item)}
                                onMouseEnter={() => position >= 0 && setActive(position)}
                                className={`w-full flex items-start gap-2.5 px-3 py-1.5 text-start outline-none focus-visible:bg-surface-raised hover:bg-surface-raised ${
                                    item.disabled ? "text-text-tertiary cursor-default" : item.danger ? "text-danger" : "text-text-primary"
                                }`}
                            >
                                {item.icon && <span className="mt-0.5 flex-shrink-0 text-text-secondary">{item.icon}</span>}
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate">{item.label}</span>
                                    {item.description && (
                                        <span className="block text-[12px] leading-4 text-text-secondary">{item.description}</span>
                                    )}
                                </span>
                                {item.shortcut && <Kbd className="mt-0.5">{item.shortcut}</Kbd>}
                                {radio && (
                                    <span className="mt-0.5 w-4 flex-shrink-0">{item.checked && <Icon name="check" size={16} />}</span>
                                )}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
