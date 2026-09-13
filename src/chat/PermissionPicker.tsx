import { useEffect, useRef } from "react";
import { Check, ChevronRight, ShieldCheck } from "lucide-react";
import { PERMISSION_MODES } from "../app/modes";
import type { PermissionMode } from "../types";

interface PermissionPickerProps {
  mode: PermissionMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (mode: PermissionMode) => void;
  t: (key: string) => string;
}

// The Code composer's permission pill: how much the model may do in this project without asking.
export default function PermissionPicker({ mode, open, onOpenChange, onPick, t }: PermissionPickerProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const current = PERMISSION_MODES.find((one) => one.id === mode) ?? PERMISSION_MODES[1];

  useEffect(() => {
    if (!open) return;

    const onDown = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) onOpenChange(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t("permissionMode")}
        className={`composer-pill ${mode === "auto" ? "!text-amber-600" : ""}`}
      >
        <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0" />
        {t(current.label)}
        <ChevronRight
          className={`w-3 h-3 flex-shrink-0 transition-transform ${open ? "rotate-90" : "-rotate-90"}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t("permissionMode")}
          className="absolute bottom-[42px] left-0 w-72 ui-box p-2 z-50 flex flex-col gap-1"
        >
          {PERMISSION_MODES.map((option) => {
            const selected = option.id === mode;

            return (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  onPick(option.id);
                  onOpenChange(false);
                }}
                className={`flex items-start gap-2 px-2.5 py-2 rounded-lg text-left transition-colors ${
                  selected
                    ? "bg-[var(--bg-inverted)] text-[var(--text-inverted)]"
                    : "hover:bg-[var(--hover-bg)]"
                }`}
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-xs font-bold">{t(option.label)}</span>
                  <span className="block text-[11px] font-medium opacity-70 leading-snug">
                    {t(option.hint)}
                  </span>
                </span>
                {selected && <Check className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
