import React from "react";

export interface SegmentedControlOption<T extends string | number> {
    value: T;
    label: string;
    icon?: React.ReactNode;
    disabled?: boolean;
    /** Says why an option is disabled, on hover. */
    title?: string;
}

export interface SegmentedControlProps<T extends string | number> {
    options: SegmentedControlOption<T>[];
    value: T;
    onChange: (value: T) => void;
    size?: "default" | "dense";
    /** Spans the width of its container, the options sharing it equally. */
    fill?: boolean;
    className?: string;
    ariaLabel?: string;
}

/* Sliding pill selection control supporting roving keyboard focus. */
export function SegmentedControl<T extends string | number>({
    options,
    value,
    onChange,
    size = "default",
    fill = false,
    className = "",
    ariaLabel,
}: SegmentedControlProps<T>) {
    const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
        const enabledOptions = options.map((opt, i) => ({ opt, index: i })).filter((x) => !x.opt.disabled);
        const currentIndex = enabledOptions.findIndex((x) => x.index === index);
        if (currentIndex === -1) return;

        let targetIndex = -1;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
            targetIndex = (currentIndex + 1) % enabledOptions.length;
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
            targetIndex = (currentIndex - 1 + enabledOptions.length) % enabledOptions.length;
        }

        if (targetIndex !== -1) {
            e.preventDefault();
            onChange(enabledOptions[targetIndex].opt.value);
        }
    };

    const padClasses = size === "dense" ? "p-0.5" : "p-1";
    const itemClasses = size === "dense"
        ? "h-6 px-2.5 text-[11px] gap-1"
        : "h-7 px-3 text-[12px] gap-1.5";

    return (
        <div
            role="radiogroup"
            aria-label={ariaLabel}
            className={`${fill ? "flex w-full" : "inline-flex"} items-center rounded-pill bg-surface-raised border border-rule ${padClasses} ${className}`}
        >
            {options.map((option, idx) => {
                const isSelected = option.value === value;
                return (
                    <button
                        key={String(option.value)}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        disabled={option.disabled}
                        title={option.title}
                        tabIndex={isSelected ? 0 : -1}
                        onClick={() => !option.disabled && onChange(option.value)}
                        onKeyDown={(e) => handleKeyDown(e, idx)}
                        className={`${fill ? "flex-1" : ""} inline-flex items-center justify-center font-medium rounded-pill transition-all duration-120 select-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary ${itemClasses} ${
                            isSelected
                                ? "bg-surface-base text-text-primary shadow-xs"
                                : "bg-transparent text-text-secondary hover:text-text-primary"
                        }`}
                    >
                        {option.icon && <span className="shrink-0">{option.icon}</span>}
                        <span>{option.label}</span>
                    </button>
                );
            })}
        </div>
    );
}
