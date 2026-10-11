import { Group, Row } from "../../settings/Controls";
import { Button } from "../../ui/Button";
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
    <div className="space-y-8">
      <StepHeader title={t("onbReadyTitle")} />

      <Group>
        {summary.map((item) => (
          <Row key={item.label} label={item.label} description={item.value}>
            <Button variant="ghost" size="dense" onClick={() => onEdit(item.step)} aria-label={`${t("edit")}: ${item.label}`}>
              {t("edit")}
            </Button>
          </Row>
        ))}
      </Group>

      {pending && (
        <div className="space-y-2">
          <DownloadBar download={download} large language={language} t={t} />
          {!download.modelless && <p className="text-[13px] leading-5 text-text-tertiary">{t("onbReadyWaiting")}</p>}
        </div>
      )}

      {moreProviders && <p className="text-[13px] leading-5 text-text-tertiary">{t("onbReadyMoreProviders")}</p>}

      <div className="flex flex-col items-center gap-5 pt-2">
        <Button onClick={() => onStart()} disabled={!canStart} className="h-10! min-w-40 px-6! text-[14px]!">
          {t("onbStart")}
        </Button>
        <div className="flex flex-col items-center gap-2">
          <p className="text-[12px] leading-4 text-text-tertiary">{t("onbPromptsTitle")}</p>
          <div className="flex flex-wrap justify-center gap-2">
            {[t("onbPrompt1"), t("onbPrompt2"), t("onbPrompt3")].map((prompt) => (
              <Button key={prompt} variant="secondary" size="dense" onClick={() => onStart(prompt)} disabled={!canStart}>
                {prompt}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
