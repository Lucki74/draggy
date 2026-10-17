import React, { useId, useRef, useState } from "react";
import { EFFORT_ORDER } from "../ai/effort";
import { EFFORT_LABELS } from "../settings/pages";
import type { EffortLevel } from "../types";
import { Icon } from "../ui";

export interface EffortSliderProps {
    value: EffortLevel;
    onChange: (level: EffortLevel) => void;
    /** Levels the model takes. Others stay pickable but are drawn dashed and sent lower. Null: all. */
    supported?: readonly EffortLevel[] | null;
    /** Levels this surface does not allow, such as Max in Chat. They show a lock and do not take the value. */
    locked?: readonly EffortLevel[];
    /** Called when a locked level is clicked, so the owner can offer the setting that unlocks it. */
    onLockedPick?: (level: EffortLevel) => void;
    /** A line under the track, such as why the level is sent lower. */
    hint?: React.ReactNode;
    variant?: "popover" | "inline";
    disabled?: boolean;
    t: (key: string) => string;
}

const LAST = EFFORT_ORDER.length - 1;

/** Five snap points from Off to Max on a gradient track. Pointer, arrow keys, Home and End all land on a dot. */
export function EffortSlider({
    value,
    onChange,
    supported = null,
    locked = [],
    onLockedPick,
    hint,
    variant = "popover",
    disabled = false,
    t,
}: EffortSliderProps) {
    const hintId = useId();
    const trackRef = useRef<HTMLDivElement>(null);
    const [dragging, setDragging] = useState(false);
    const index = EFFORT_ORDER.indexOf(value);
    const label = (level: EffortLevel) => t(EFFORT_LABELS[level]);
    const isLocked = (level: EffortLevel) => locked.includes(level);
    const topOpen = [...EFFORT_ORDER].reverse().find((level) => !isLocked(level)) ?? "off";

    const pick = (level: EffortLevel) => {
        if (disabled) return;
        if (isLocked(level)) {
            onLockedPick?.(level);
            return;
        }
        if (level !== value) onChange(level);
    };

    const levelAt = (clientX: number): EffortLevel => {
        const box = trackRef.current?.getBoundingClientRect();
        if (!box || box.width === 0) return value;
        const rtl = getComputedStyle(trackRef.current!).direction === "rtl";
        const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
        return EFFORT_ORDER[Math.round((rtl ? 1 - ratio : ratio) * LAST)];
    };

    const step = (delta: number) => {
        let at = index + delta;
        while (at >= 0 && at <= LAST && isLocked(EFFORT_ORDER[at])) at += delta;
        if (at >= 0 && at <= LAST) pick(EFFORT_ORDER[at]);
    };

    const onKeyDown = (event: React.KeyboardEvent) => {
        const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
        const keys: Record<string, () => void> = {
            ArrowRight: () => step(rtl ? -1 : 1),
            ArrowUp: () => step(1),
            ArrowLeft: () => step(rtl ? 1 : -1),
            ArrowDown: () => step(-1),
            Home: () => pick("off"),
            End: () => pick(topOpen),
        };
        const run = keys[event.key];
        if (!run) return;
        event.preventDefault();
        run();
    };

    const fill = `${(index / LAST) * 100}%`;
    const sentLower = supported && value !== "off" && !supported.includes(value);
    const width = variant === "popover" ? "w-[188px]" : "w-full max-w-[320px]";

    return (
        <div className={`flex flex-col gap-2.5 ${width} ${disabled ? "opacity-50" : ""}`}>
            <div className="flex items-baseline justify-between gap-3">
                <span className="text-[12px] text-text-secondary">{t("effort")}</span>
                <span className="text-[13px] font-medium text-[var(--accent-ink)]" aria-hidden="true">
                    {label(value)}
                </span>
            </div>

            <div
                role="slider"
                tabIndex={disabled ? -1 : 0}
                aria-label={t("effort")}
                aria-orientation="horizontal"
                aria-valuemin={0}
                aria-valuemax={LAST}
                aria-valuenow={index}
                aria-valuetext={label(value)}
                aria-disabled={disabled || undefined}
                aria-describedby={hint ? hintId : undefined}
                onKeyDown={onKeyDown}
                className="group relative h-8 mx-2 cursor-pointer touch-none select-none rounded-pill focus-visible:outline-none"
            >
                <div ref={trackRef} className="absolute inset-y-0 inset-x-0" onPointerDown={(event) => {
                    if (disabled) return;
                    event.currentTarget.setPointerCapture?.(event.pointerId);
                    setDragging(true);
                    pick(levelAt(event.clientX));
                }}
                onPointerMove={(event) => {
                    if (dragging) pick(levelAt(event.clientX));
                }}
                onPointerUp={() => setDragging(false)}
                onPointerCancel={() => setDragging(false)}>
                    <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-pill bg-surface-tint" />
                    <div
                        className="absolute top-1/2 h-1 -translate-y-1/2 rounded-pill start-0"
                        style={{ width: fill, background: "linear-gradient(90deg, var(--accent-soft), var(--accent))" }}
                    />
                    {EFFORT_ORDER.map((level, at) => {
                        const reached = at <= index;
                        const off = supported && level !== "off" && !supported.includes(level);
                        const lock = isLocked(level);
                        return (
                            <span
                                key={level}
                                data-level={level}
                                title={label(level)}
                                className={`absolute top-1/2 size-2 -translate-y-1/2 -translate-x-1/2 rounded-pill border ${
                                    off ? "border-dashed" : ""
                                } ${reached && !lock ? "bg-[var(--accent)] border-[var(--accent)]" : "bg-surface-base border-rule-strong"}`}
                                style={{ insetInlineStart: `${(at / LAST) * 100}%` }}
                            >
                                {lock && (
                                    <span className="absolute -top-4 start-1/2 -translate-x-1/2 text-text-secondary">
                                        <Icon name="lock-simple" size={10} />
                                    </span>
                                )}
                            </span>
                        );
                    })}
                    <span
                        data-thumb
                        className="absolute top-1/2 size-3.5 -translate-y-1/2 -translate-x-1/2 rounded-pill bg-[var(--accent)] border-2 border-surface-base shadow-xs group-focus-visible:ring-2 group-focus-visible:ring-[var(--accent-soft)] motion-safe:transition-[inset-inline-start] motion-safe:duration-150 motion-safe:ease-out"
                        style={{ insetInlineStart: fill }}
                    />
                </div>
            </div>

            <div className="flex justify-between text-[11px] text-text-secondary px-0.5" aria-hidden="true">
                <span>{label("off")}</span>
                <span>{label("max")}</span>
            </div>

            {(hint || sentLower) && (
                <p id={hintId} className="text-[12px] leading-snug text-text-secondary">
                    {hint ??
                        t("effortSentAs").replace(
                            "{level}",
                            label([...(supported ?? [])].filter((level) => EFFORT_ORDER.indexOf(level) <= index).pop() ?? "off"),
                        )}
                </p>
            )}
        </div>
    );
}

