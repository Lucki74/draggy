import { Choice } from "../onboarding/steps/Choice";
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
          <Choice key={option.id} selected={selected} onSelect={() => onChange(option.id)} title={t(option.label)}>
            {t(option.hint)}
          </Choice>
        );
      })}
    </div>
  );
}
