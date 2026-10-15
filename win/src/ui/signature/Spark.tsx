import React from "react";

export interface SparkProps {
    className?: string;
    label?: string;
}

/* Ember pulse indicates active computation in progress. */
export function Spark({ className = "", label }: SparkProps) {
    return (
        <span
            className={`spark-dot inline-block shrink-0 ${className}`}
            role={label ? "status" : undefined}
            aria-label={label}
            aria-hidden={label ? undefined : true}
        />
    );
}
