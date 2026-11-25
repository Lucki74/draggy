import React from "react";
import { Icon } from "./icons/Icon";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "default" | "dense";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    loading?: boolean;
    icon?: React.ReactNode;
    iconEnd?: React.ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
    primary: "bg-action-bg text-action-fg hover:opacity-90 active:opacity-80",
    secondary: "bg-surface-base text-text-primary border border-rule-control hover:bg-surface-raised active:bg-surface-raised/80",
    ghost: "bg-transparent text-text-secondary hover:text-text-primary hover:bg-surface-raised active:bg-surface-raised/80",
    danger: "bg-transparent text-danger border border-danger/30 hover:bg-danger/10 active:bg-danger/20",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
    default: "h-8 px-3.5 text-[13px] gap-1.5",
    dense: "h-7 px-2.5 text-[12px] gap-1",
};

/* Pill button with precise hairline borders and focus rings. */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    {
        variant = "primary",
        size = "default",
        loading = false,
        disabled = false,
        icon,
        iconEnd,
        children,
        className = "",
        type = "button",
        ...props
    },
    ref,
) {
    const isDisabled = disabled || loading;

    return (
        <button
            ref={ref}
            type={type}
            disabled={isDisabled}
            aria-busy={loading ? "true" : undefined}
            className={`inline-flex items-center justify-center font-medium rounded-pill transition-colors duration-120 select-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
            {...props}
        >
            {loading ? (
                <Icon name="circle-notch" size={16} className="animate-spin shrink-0" aria-hidden />
            ) : (
                icon
            )}
            {children}
            {!loading && iconEnd}
        </button>
    );
});
