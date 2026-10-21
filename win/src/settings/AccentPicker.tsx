import { ACCENTS } from "../app/accent";
import { Icon } from "../ui/icons/Icon";

/** The seven accents as swatches. The mark shows the choice in more than colour. */
export function AccentPicker({
  value,
  onChange,
  t,
}: {
  value: string;
  onChange: (accent: string) => void;
  t: (key: string) => string;
}) {
  const current = ACCENTS.some((one) => one.id === value) ? value : ACCENTS[0].id;
  return (
    <div role="radiogroup" aria-label={t("accentColor")} className="flex flex-wrap gap-2">
      {ACCENTS.map((one) => {
        const label = t(`accent_${one.id}`);
        const selected = one.id === current;
        return (
          <button
            key={one.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            onClick={() => onChange(one.id)}
            style={{ backgroundColor: one.color }}
            className={`flex h-7 w-7 items-center justify-center rounded-full outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas ${
              selected ? "shadow-[0_0_0_2px_var(--surface-canvas),0_0_0_4px_var(--text-primary)]" : "hover:shadow-[0_0_0_2px_var(--rule-control)]"
            }`}
          >
            {selected && <Icon name="check" size={14} className="text-black mix-blend-difference" />}
          </button>
        );
      })}
    </div>
  );
}
