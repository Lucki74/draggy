export type LoadStage = {
  stage: "disk" | "loading" | "readying" | "reading";
  percent?: number;
  tokensPerSecond?: number;
};

const STEP = 3;

/** Where the wait stands across its steps, from the numbers the engine reported: loading the weights
 * takes the first half and reading the prompt the second. Steps of 3, never 100 before the first token. */
export function overallPercent(stage: LoadStage | null): number {
  let raw = 0;
  if (stage?.stage === "loading") raw = (stage.percent ?? 0) / 2;
  else if (stage?.stage === "readying") raw = 50;
  else if (stage?.stage === "reading") raw = 50 + (stage.percent ?? 0) / 2;
  return Math.max(0, Math.min(99, Math.floor(raw / STEP) * STEP));
}

/** The line a wait shows. A reload for a bigger window shows one step, its overall percent. */
export function loadLabel(
  stage: LoadStage | null,
  options: { model: string; extending?: boolean; t: (key: string) => string },
): string {
  const { model, extending, t } = options;
  if (extending) return t("extendingContext").replace("{percent}", String(overallPercent(stage)));
  const percent = String(stage?.percent ?? 0);
  switch (stage?.stage) {
    case "loading":
      return t("loadingStageLoading").replace("{model}", model).replace("{percent}", percent);
    case "readying":
      return t("loadingStageReadying").replace("{model}", model);
    case "reading":
      return stage.tokensPerSecond === undefined
        ? t("loadingStageReading").replace("{percent}", percent)
        : t("loadingStageReadingSpeed").replace("{percent}", percent).replace("{speed}", String(stage.tokensPerSecond));
    default:
      return t("loadingStageDisk").replace("{model}", model);
  }
}
