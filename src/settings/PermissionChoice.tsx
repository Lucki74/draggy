import { Check } from "lucide-react";
import { PERMISSION_MODES } from "../app/modes";
import type { PermissionMode } from "../types";

interface PermissionChoiceProps {
  value: PermissionMode;
  onChange: (mode: PermissionMode) => void;
  label: string;
  t: (key: string) => string;
}

// The four permission modes side by side, each saying what it lets the model do.
export default function PermissionChoice({ value, onChange, label, t }: PermissionChoiceProps) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-2 sm:grid-cols-2">
      {PERMISSION_MODES.map((option) => {
        const selected = option.id === value;

        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.id)}
            className={`flex items-start gap-2 rounded-lg border-2 px-3 py-2.5 text-left transition-colors ${
              selected
                ? "border-[var(--text-main)] bg-[var(--hover-bg)]"
                : "border-[var(--border-light)] bg-[var(--bg-base)] hover:bg-[var(--hover-bg)]"
            }`}
          >
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-bold">{t(option.label)}</span>
              <span className="mt-0.5 block text-xs font-medium leading-snug text-[var(--text-muted)]">
                {t(option.hint)}
              </span>
            </span>
            {selected && <Check className="w-4 h-4 mt-0.5 flex-shrink-0" />}
          </button>
        );
      })}
    </div>
  );
}
