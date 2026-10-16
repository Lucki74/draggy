import React from "react";

export interface FuseProps {
    progress?: number;
    className?: string;
    label?: string;
}

/* Travelling ember head indicates turn progress along composer edge. */
export function Fuse({ progress, className = "", label }: FuseProps) {
    const isDeterminate = typeof progress === "number" && !Number.isNaN(progress);
    const clamped = isDeterminate ? Math.max(0, Math.min(1, progress)) : undefined;

    return (
        <div
            className={`fuse-track relative h-[2px] w-full overflow-hidden bg-transparent ${className}`}
            role="progressbar"
            aria-label={label ?? "Turn progress"}
            aria-valuenow={clamped !== undefined ? Math.round(clamped * 100) : undefined}
            aria-valuemin={0}
            aria-valuemax={100}
        >
            {clamped !== undefined ? (
                <div
                    className="fuse-determinate h-full relative"
                    style={{ width: `${clamped * 100}%`, backgroundColor: "var(--rule-strong)" }}
                >
                    <span
                        className="absolute end-0 top-0 h-full w-[6px] translate-x-1/2"
                        style={{ background: "linear-gradient(to right, var(--ember-1), var(--ember-2))" }}
                    />
                </div>
            ) : (
                <div className="fuse-indeterminate-head" />
            )}
        </div>
    );
}
