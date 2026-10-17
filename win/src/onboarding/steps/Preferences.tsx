import { useState } from "react";
import { Block, Group, Row, Segmented, Select, Toggle } from "../../settings/Controls";
import PermissionChoice from "../../settings/PermissionChoice";
import { effortOptions, searchProviderOptions } from "../../settings/pages";
import { allowedEfforts } from "../../ai/effort";
import type { AppMode } from "../../app/modes";
import type { AppSettings, SearchProvider } from "../../types";
import { Icon } from "../../ui/icons/Icon";
import { fill } from "../text";
import { formatBytes } from "../../formatBytes";
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
  const gb = (bytes: number) => formatBytes(bytes, language);

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
          className="h-4 w-4 accent-[var(--text-primary)] disabled:opacity-60"
        />
      </Row>
    );
  };

  return (
    <div className="space-y-8">
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
            <Row label={t("onbPermissionTitle")} />
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
          className="-mx-1 inline-flex items-center gap-1 rounded-xs px-1 text-[13px] text-text-secondary outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-focus"
        >
          {t("onbMore")}
          <Icon name="caret-right" size={14} className={`transition-transform ${more ? "rotate-90" : ""}`} />
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
                value={settings.effort}
                options={effortOptions(t, allowedEfforts("chat", settings.allowMaxInChat))}
                onChange={(effort) => onUpdateSettings({ effort })}
              />
            </Row>
          </Group>
        )}
      </div>
    </div>
  );
}
