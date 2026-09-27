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
  onStart,
  language,
  t,
}: {
  summary: SummaryItem[];
  onEdit: (step: StepId) => void;
  download: FirstDownload;
  canStart: boolean;
  onStart: () => void;
  language: string;
  t: (key: string) => string;
}) {
  return (
    <div className="space-y-6">
      <StepHeader title={t("onbReadyTitle")} body={t("onbReadyBody")} />

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

      {!canStart && (
        <div className="space-y-2">
          <DownloadBar download={download} large language={language} t={t} />
          <p className="text-center text-xs font-bold text-[var(--text-muted)]">{t("onbReadyWaiting")}</p>
        </div>
      )}

      <div className="flex justify-center">
        <button type="button" onClick={onStart} disabled={!canStart} className="ui-btn px-8 py-3 disabled:opacity-40 disabled:cursor-not-allowed">
          {t("onbStart")}
        </button>
      </div>
    </div>
  );
}
