import { Group, Row } from "../../settings/Controls";
import DownloadBar from "../DownloadBar";
import type { StepId } from "../flow";
import type { FirstDownload } from "../useFirstDownload";
import StepHeader from "./StepHeader";

export interface SummaryItem {
  label: string;
  value: string;
  step: StepId;
}

export default function Ready({
  summary,
  onEdit,
  download,
  canStart,
  moreProviders = false,
  onStart,
  language,
  t,
}: {
  summary: SummaryItem[];
  onEdit: (step: StepId) => void;
  download: FirstDownload;
  canStart: boolean;
  /** A provider was set up here; others are added in Settings. */
  moreProviders?: boolean;
  /** With a prompt, the app opens with it in the composer, not sent. */
  onStart: (prompt?: string) => void;
  language: string;
  t: (key: string) => string;
}) {
  const pending = download.modelless
    ? download.engine.phase === "running"
    : download.model.phase !== "done" || download.engine.phase === "running";
  return (
    <div className="space-y-6">
      <StepHeader title={t("onbReadyTitle")} />

      <Group>
        {summary.map((item) => (
          <Row key={item.label} label={item.label} description={item.value}>
            <button
              type="button"
              onClick={() => onEdit(item.step)}
              aria-label={`${t("edit")}: ${item.label}`}
              className="text-xs font-bold text-[var(--text-muted)] hover:text-[var(--text-main)] underline-offset-2 hover:underline"
            >
              {t("edit")}
            </button>
          </Row>
        ))}
      </Group>

      {pending && (
        <div className="space-y-2">
          <DownloadBar download={download} large language={language} t={t} />
          {!download.modelless && <p className="text-center text-xs font-bold text-[var(--text-muted)]">{t("onbReadyWaiting")}</p>}
        </div>
      )}

      {moreProviders && <p className="text-center text-xs font-bold text-[var(--text-muted)]">{t("onbReadyMoreProviders")}</p>}

      <div className="flex justify-center">
        <button type="button" onClick={() => onStart()} disabled={!canStart} className="ui-btn px-8 py-3 disabled:opacity-40 disabled:cursor-not-allowed">
          {t("onbStart")}
        </button>
      </div>

      <div className="space-y-2">
        <p className="text-center text-xs font-bold text-[var(--text-muted)]">{t("onbPromptsTitle")}</p>
        <div className="flex flex-wrap justify-center gap-2">
          {[t("onbPrompt1"), t("onbPrompt2"), t("onbPrompt3")].map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => onStart(prompt)}
              disabled={!canStart}
              className="px-3 py-1.5 rounded-full border-2 border-[var(--border-light)] bg-[var(--bg-panel)] text-xs font-bold text-[var(--text-main)] enabled:hover:border-[var(--text-muted)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
