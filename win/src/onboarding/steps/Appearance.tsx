import { Group, Row, Segmented, Select } from "../../settings/Controls";
import { languages } from "../../translations";
import { THEME_PALETTES, type Palette } from "../palettes";
import type { AppSettings, Language } from "../../types";
import StepHeader from "./StepHeader";

type Theme = AppSettings["theme"];

/** The chat screen in miniature, in one theme's own colours whatever the page is showing now. */
function Miniature({ palette }: { palette: Palette }) {
  return (
    <div aria-hidden="true" className="flex h-24 w-full overflow-hidden" style={{ backgroundColor: palette.canvas }}>
      <div className="flex h-full w-7 flex-col gap-1.5 px-1.5 pt-2.5" style={{ borderInlineEnd: `1px solid ${palette.rule}` }}>
        <div className="h-1.5 w-full rounded-pill" style={{ backgroundColor: palette.raised }} />
        <div className="h-1.5 w-3/4 rounded-pill" style={{ backgroundColor: palette.rule }} />
        <div className="h-1.5 w-full rounded-pill" style={{ backgroundColor: palette.rule }} />
      </div>
      <div className="flex flex-1 flex-col justify-end gap-1.5 p-2.5">
        <div className="h-3 w-2/5 self-end rounded-pill" style={{ backgroundColor: palette.raised }} />
        <div className="h-1.5 w-4/5 rounded-pill" style={{ backgroundColor: palette.tertiary, opacity: 0.6 }} />
        <div className="h-1.5 w-3/5 rounded-pill" style={{ backgroundColor: palette.tertiary, opacity: 0.6 }} />
        <div
          className="mt-1 h-4 w-full rounded-pill"
          style={{ backgroundColor: palette.base, border: `1px solid ${palette.ruleControl}` }}
        />
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
  language,
  onTheme,
  onFontSize,
  onLanguage,
  t,
}: {
  theme: Theme;
  fontSize: AppSettings["fontSize"];
  language: Language;
  onTheme: (theme: Theme) => void;
  onFontSize: (fontSize: AppSettings["fontSize"]) => void;
  onLanguage: (language: Language) => void;
  t: (key: string) => string;
}) {
  const cards: { id: Theme; label: string }[] = [
    { id: "light", label: t("light") },
    { id: "dark", label: t("dark") },
    { id: "system", label: t("themeSystem") },
  ];

  return (
    <div className="space-y-8">
      <StepHeader title={t("onbAppearanceTitle")} />

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
              className="group flex flex-col gap-2 rounded-md text-start outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas"
            >
              <span
                className={`block overflow-hidden rounded-md transition-shadow ${
                  selected
                    ? "shadow-[0_0_0_2px_var(--text-primary)]"
                    : "shadow-[0_0_0_1px_var(--rule-strong)] group-hover:shadow-[0_0_0_1px_var(--rule-control)]"
                }`}
              >
                {card.id === "system" ? <SystemMiniature /> : <Miniature palette={THEME_PALETTES[card.id]} />}
              </span>
              <span className={`text-[13px] ${selected ? "font-medium text-text-primary" : "text-text-secondary"}`}>
                {card.label}
              </span>
            </button>
          );
        })}
      </div>

      <Group>
        <Row label={t("language")}>
          <Select
            label={t("language")}
            value={language}
            options={languages.map((entry) => ({ id: entry.code, label: entry.name }))}
            onChange={(value) => onLanguage(value as Language)}
          />
        </Row>
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
