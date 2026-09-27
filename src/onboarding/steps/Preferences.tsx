import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Block, Group, Row, Segmented, Select, Toggle } from "../../settings/Controls";
import PermissionChoice from "../../settings/PermissionChoice";
import { searchProviderOptions, thinkingOptions } from "../../settings/pages";
import type { AppMode } from "../../app/modes";
import type { AppSettings, SearchProvider } from "../../types";
import { fill } from "../text";
import StepHeader from "./StepHeader";

/** One optional download, sized to this computer, or already on it. */
export interface ExtraOffer {
  label: string;
  sizeBytes: number;
  installed: boolean;
}

export type ExtraKind = "voice" | "library";

export default function Preferences({
  settings,
  onUpdateSettings,
  mode,
  onMode,
  offers,
  chosen,
  onExtra,
  language,
  t,
}: {
  settings: AppSettings;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  mode: AppMode;
  onMode: (mode: AppMode) => void;
  offers: Record<ExtraKind, ExtraOffer | null>;
  chosen: Record<ExtraKind, boolean>;
  onExtra: (kind: ExtraKind, on: boolean) => void;
  language: string;
  t: (key: string) => string;
}) {
  const [more, setMore] = useState(false);
  const gb = (bytes: number) => `${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(bytes / 1e9)} GB`;

  const extraRow = (kind: ExtraKind, labelKey: string, hintKey: string) => {
    const offer = offers[kind];
    if (!offer) return null;
    const label = t(labelKey);
    return (
      <Row
        key={kind}
        label={label}
        description={offer.installed ? t("onbExtraInstalled") : fill(t(hintKey), { model: offer.label, size: gb(offer.sizeBytes) })}
      >
        <input
          type="checkbox"
          checked={offer.installed || chosen[kind]}
          disabled={offer.installed}
          onChange={(event) => onExtra(kind, event.target.checked)}
          aria-label={label}
          className="w-4 h-4 accent-[var(--text-main)]"
        />
      </Row>
    );
  };

  return (
    <div className="space-y-6">
      <StepHeader title={t("onbPrefsTitle")} />

      <Group>
        <Row label={t("onbStartIn")}>
          <Segmented
            label={t("onbStartIn")}
            value={mode}
            options={[
              { id: "chat", label: t("chatMode") },
              { id: "code", label: t("codeMode") },
            ]}
            onChange={onMode}
          />
        </Row>
        {mode === "code" && (
          <>
            <Row label={t("onbPermissionTitle")} description={t("onbPermissionHint")} />
            <Block>
              <PermissionChoice
                value={settings.codePermissionMode}
                onChange={(codePermissionMode) => onUpdateSettings({ codePermissionMode })}
                label={t("onbPermissionTitle")}
                t={t}
              />
            </Block>
          </>
        )}
        <Row label={t("searchProvider")}>
          <Select
            label={t("searchProvider")}
            value={settings.searchProvider}
            options={searchProviderOptions(t)}
            onChange={(searchProvider) => onUpdateSettings({ searchProvider: searchProvider as SearchProvider })}
          />
        </Row>
        <Row label={t("onbUpdates")}>
          <Toggle label={t("onbUpdates")} checked={settings.autoUpdate} onChange={(autoUpdate) => onUpdateSettings({ autoUpdate })} />
        </Row>
      </Group>

      <Group title={t("onbExtrasTitle")}>
        {extraRow("voice", "onbExtraVoice", "onbExtraVoiceHint")}
        {extraRow("library", "onbExtraLibrary", "onbExtraLibraryHint")}
      </Group>

      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setMore((open) => !open)}
          aria-expanded={more}
          className="inline-flex items-center gap-1 text-xs font-bold text-[var(--text-muted)] hover:text-[var(--text-main)]"
        >
          {t("onbMore")}
          <ChevronRight className={`w-3.5 h-3.5 transition-transform ${more ? "rotate-90" : ""}`} />
        </button>
        {more && (
          <Group>
            <Row label={t("showMetrics")}>
              <Toggle
                label={t("showMetrics")}
                checked={settings.showMetrics}
                onChange={(showMetrics) => onUpdateSettings({ showMetrics, metricsChosen: true })}
              />
            </Row>
            <Row label={t("thinking")}>
              <Segmented
                label={t("thinking")}
                value={settings.thinkingMode}
                options={thinkingOptions(t)}
                onChange={(thinkingMode) => onUpdateSettings({ thinkingMode })}
              />
            </Row>
          </Group>
        )}
      </div>
    </div>
  );
}
