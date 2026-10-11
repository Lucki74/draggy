import React from "react";

export interface EmberCaretProps {
    className?: string;
}

/* Gradient caret flickers at active streaming boundary. */
export function EmberCaret({ className = "" }: EmberCaretProps) {
    return (
        <span
            className={`ember-caret ${className}`}
            aria-hidden="true"
        />
    );
}
