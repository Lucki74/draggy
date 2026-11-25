import React from "react";

export interface TabsProps<T extends string> {
    tabs: { id: T; label: string }[];
    value: T;
    onChange: (value: T) => void;
    label: string;
    /** The id of the panel the tabs control, so a screen reader can move from tab to content. */
    panelId?: string;
    className?: string;
}

/** Tabs for switching between views of one screen: an underline under the chosen one. Arrow keys
 * move along the row and pick as they go; Home and End jump to the ends. */
export function Tabs<T extends string>({ tabs, value, onChange, label, panelId, className = "" }: TabsProps<T>) {
    const onKeyDown = (event: React.KeyboardEvent, index: number) => {
        const last = tabs.length - 1;
        const next =
            event.key === "ArrowRight" ? (index + 1) % tabs.length
            : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length
            : event.key === "Home" ? 0
            : event.key === "End" ? last
            : -1;
        if (next === -1) return;
        event.preventDefault();
        onChange(tabs[next].id);
        const row = event.currentTarget.parentElement;
        row?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
    };

    return (
        <div role="tablist" aria-label={label} className={`flex gap-5 shadow-[inset_0_-1px_0_var(--rule)] ${className}`}>
            {tabs.map((tab, index) => {
                const selected = tab.id === value;
                return (
                    <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        aria-controls={panelId}
                        tabIndex={selected ? 0 : -1}
                        onClick={() => onChange(tab.id)}
                        onKeyDown={(event) => onKeyDown(event, index)}
                        className={`-mb-px border-b-2 pb-2 pt-1 text-[13px] font-medium outline-none transition-colors focus-visible:rounded-xs focus-visible:ring-2 focus-visible:ring-focus ${
                            selected
                                ? "border-text-primary text-text-primary"
                                : "border-transparent text-text-secondary hover:text-text-primary"
                        }`}
                    >
                        {tab.label}
                    </button>
                );
            })}
        </div>
    );
}
