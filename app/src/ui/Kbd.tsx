import React from "react";

export interface KbdProps extends React.HTMLAttributes<HTMLElement> {
    children: React.ReactNode;
    className?: string;
}

/* Keyboard shortcut hint rendered in JetBrains Mono with subtle hairline. */
export function Kbd({ children, className = "", ...props }: KbdProps) {
    return (
        <kbd
            className={`inline-flex items-center justify-center px-1.5 py-0.5 text-[11px] font-mono leading-none rounded-xs bg-surface-tint border border-rule text-text-secondary ${className}`}
            {...props}
        >
            {children}
        </kbd>
    );
}
