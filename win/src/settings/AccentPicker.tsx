import { ACCENTS } from "../app/accent";
import { Icon } from "../ui/icons/Icon";
import { Menu, type MenuEntry } from "../ui/Menu";

const Dot = ({ color }: { color: string }) => (
  <span aria-hidden className="block h-4 w-4 shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgba(128,128,128,0.35)]" style={{ backgroundColor: color }} />
);

/** The seven accents in a dropdown: a rounded box holding the colour and its name, an arrow on the right. */
export function AccentPicker({
  value,
  onChange,
  t,
}: {
  value: string;
  onChange: (accent: string) => void;
  t: (key: string) => string;
}) {
  const current = ACCENTS.find((one) => one.id === value) ?? ACCENTS[0];
  const items: MenuEntry[] = ACCENTS.map((one) => ({
    id: one.id,
    label: t(`accent_${one.id}`),
    icon: <Dot color={one.color} />,
    checked: one.id === current.id,
    onSelect: () => onChange(one.id),
  }));
  return (
    <Menu
      label={t("accentColor")}
      align="end"
      items={items}
      trigger={(props) => (
        <button
          {...props}
          type="button"
          className="flex h-8 min-w-40 items-center gap-2 rounded-lg border border-rule-control bg-surface-canvas px-2.5 text-sm text-text-primary outline-none transition-colors hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-focus"
        >
          <Dot color={current.color} />
          <span className="flex-1 truncate text-start">{t(`accent_${current.id}`)}</span>
          <Icon name="caret-down" size={14} className="text-text-secondary" />
        </button>
      )}
    />
  );
}
