import React from "react";
import { Icon, type IconName } from "./icons/Icon";

export type IconButtonVariant = "ghost" | "secondary" | "primary" | "danger";
export type IconButtonSize = "default" | "dense" | "sm";

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
    name: IconName;
    label: string;
    shortcut?: string;
    size?: IconButtonSize;
    variant?: IconButtonVariant;
    filled?: boolean;
    mirrored?: boolean;
}

const VARIANT_CLASSES: Record<IconButtonVariant, string> = {
    ghost: "bg-transparent text-text-secondary hover:text-text-primary hover:bg-surface-raised active:bg-surface-raised/80",
    secondary: "bg-surface-base text-text-primary border border-rule hover:bg-surface-raised active:bg-surface-raised/80",
    primary: "bg-action-bg text-action-fg hover:opacity-90 active:opacity-80",
    danger: "bg-transparent text-danger hover:bg-danger/10 active:bg-danger/20",
};

const SIZE_CLASSES: Record<IconButtonSize, { btn: string; iconSize: 16 | 20 }> = {
    default: { btn: "h-8 w-8 min-w-[32px]", iconSize: 20 },
    dense: { btn: "h-7 w-7 min-w-[28px]", iconSize: 16 },
    sm: { btn: "h-6 w-6 min-w-[24px]", iconSize: 16 },
};

/* Icon-only button enforcing accessible label and shortcut metadata. */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
    {
        name,
        label,
        shortcut,
        size = "default",
        variant = "ghost",
        filled = false,
        mirrored = false,
        disabled = false,
        className = "",
        type = "button",
        ...props
    },
    ref,
) {
    const accessibleTitle = shortcut ? `${label} (${shortcut})` : label;
    const { btn, iconSize } = SIZE_CLASSES[size];

    return (
        <button
            ref={ref}
            type={type}
            disabled={disabled}
            aria-label={accessibleTitle}
            title={accessibleTitle}
            className={`inline-flex items-center justify-center rounded-pill transition-colors duration-120 select-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas ${VARIANT_CLASSES[variant]} ${btn} ${className}`}
            {...props}
        >
            <Icon name={name} size={iconSize} filled={filled} mirrored={mirrored} aria-hidden />
        </button>
    );
});
