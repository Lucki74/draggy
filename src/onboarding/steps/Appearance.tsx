import { Group, Row, Segmented } from "../../settings/Controls";
import { THEME_PALETTES, type Palette } from "../palettes";
import type { AppSettings } from "../../types";
import StepHeader from "./StepHeader";

type Theme = AppSettings["theme"];

/** The chat screen in miniature, in one theme's own colours whatever the page is showing now. */
function Miniature({ palette }: { palette: Palette }) {
  return (
    <div
      aria-hidden="true"
      className="h-24 w-full rounded-lg overflow-hidden flex border-2"
      style={{ backgroundColor: palette.base, borderColor: palette.border }}
    >
      <div className="w-5 h-full" style={{ backgroundColor: palette.panel, borderRight: `2px solid ${palette.border}` }} />
      <div className="flex-1 flex flex-col justify-end gap-1.5 p-2">
        <div className="self-end h-3 w-2/5 rounded-md" style={{ backgroundColor: palette.inverted }} />
        <div className="h-3 w-3/5 rounded-md" style={{ backgroundColor: palette.muted, opacity: 0.5 }} />
        <div className="h-4 w-full rounded-md border-2" style={{ backgroundColor: palette.input, borderColor: palette.border }} />
      </div>
    </div>
  );
}

/** Match system shows both halves, since it becomes whichever the computer is set to. */
function SystemMiniature() {
  return (
    <div className="relative h-24 w-full">
      <div className="absolute inset-0" style={{ clipPath: "polygon(0 0, 100% 0, 0 100%)" }}>
        <Miniature palette={THEME_PALETTES.light} />
      </div>
      <div className="absolute inset-0" style={{ clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }}>
        <Miniature palette={THEME_PALETTES.dark} />
      </div>
    </div>
  );
}

export default function Appearance({
  theme,
  fontSize,
  onTheme,
  onFontSize,
  t,
}: {
  theme: Theme;
  fontSize: AppSettings["fontSize"];
  onTheme: (theme: Theme) => void;
  onFontSize: (fontSize: AppSettings["fontSize"]) => void;
  t: (key: string) => string;
}) {
  const cards: { id: Theme; label: string }[] = [
    { id: "light", label: t("light") },
    { id: "dark", label: t("dark") },
    { id: "system", label: t("themeSystem") },
  ];

  return (
    <div className="space-y-8">
      <StepHeader title={t("onbAppearanceTitle")} body={t("onbAppearanceBody")} />

      <div role="radiogroup" aria-label={t("theme")} className="grid grid-cols-3 gap-3">
        {cards.map((card) => {
          const selected = card.id === theme;
          return (
            <button
              key={card.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onTheme(card.id)}
              className={`p-2 rounded-xl border-[3px] bg-[var(--bg-panel)] text-left transition-colors ${
                selected ? "border-[var(--text-main)]" : "border-[var(--border-light)] hover:border-[var(--text-muted)]"
              }`}
            >
              {card.id === "system" ? <SystemMiniature /> : <Miniature palette={THEME_PALETTES[card.id]} />}
              <span className="mt-2 block text-center text-xs font-bold">{card.label}</span>
            </button>
          );
        })}
      </div>

      <Group>
        <Row label={t("textSize")}>
          <Segmented
            label={t("textSize")}
            value={fontSize}
            options={[
              { id: "sm", label: t("textSmall") },
              { id: "base", label: t("textMedium") },
              { id: "lg", label: t("textLarge") },
            ]}
            onChange={onFontSize}
          />
        </Row>
      </Group>
    </div>
  );
}
