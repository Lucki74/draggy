import { useEffect, useState } from "react";
import { Icon } from "../ui";
import SiteBadge from "./SiteBadge";
import { StepLine, linkClass } from "./StepLine";
import { fillComposer } from "./mentions";
import { useTranscriptView } from "./transcriptView";
import { hostnameOf } from "../utils";
import { stopRun } from "../research/session";
import type { Depth, SourceStatus } from "../research/run";
import type { ResearchRunView, RunViewSource } from "../research/runView";
import type { SearchStep } from "../types";

const DEPTH_KEY: Record<Depth, string> = {
  quick: "researchDepthQuick",
  standard: "researchDepthStandard",
  deep: "researchDepthDeep",
};

const STATUS_KEY: Record<SourceStatus, string> = {
  reading: "researchStatusReading",
  read: "researchStatusRead",
  skipped: "researchStatusSkipped",
  blocked: "researchStatusBlocked",
  failed: "researchStatusFailed",
};

/** 125000 ms as 2:05. */
/** A count in its label, singular when it is one. */
const count = (t: (key: string) => string, n: number, one: string, other: string) =>
  t(n === 1 ? one : other).replace("{n}", String(n));

function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const isBad = (source: RunViewSource) => source.status === "failed" || source.status === "blocked";

/** Each source once, under the first question a note of it answers; the rest go last. */
function groupSources(run: ResearchRunView) {
  const groups = run.questions.map(() => [] as RunViewSource[]);
  const placed = new Set<string>();
  for (const note of run.notes) {
    const group = groups[(note.subQuestion ?? 0) - 1];
    const source = run.sources.find((entry) => entry.id === note.sourceId);
    if (!group || !source || placed.has(source.id)) continue;
    group.push(source);
    placed.add(source.id);
  }
  return { groups, other: run.sources.filter((source) => !placed.has(source.id)) };
}

function SourceRow({ source, t }: { source: RunViewSource; t: (key: string) => string }) {
  const host = hostnameOf(source.url).replace(/^www\./i, "");
  const title = source.title === source.url ? host || source.url : source.title;
  const bad = isBad(source);
  return (
    <div role="listitem" className="group flex min-w-0 items-center gap-3">
      <button
        type="button"
        title={source.url}
        onClick={() => window.open(source.url, "_blank")}
        className={`-ms-1.5 flex min-h-[26px] min-w-0 flex-1 items-center gap-2 rounded-xs px-1.5 text-start text-[13px] outline-none hover:bg-surface-tint focus-visible:ring-2 focus-visible:ring-focus ${bad ? "text-text-tertiary" : "text-text-secondary hover:text-text-primary"}`}
      >
        <SiteBadge hostname={host} small />
        <span className="min-w-0 truncate">{title}</span>
        <span className="ms-auto max-w-[40%] flex-none truncate ps-2 text-[12px] text-text-tertiary">{host}</span>
        {source.status === "reading" && <span className="live-sweep flex-none text-[12px]">{t(STATUS_KEY.reading)}</span>}
        {source.status === "skipped" && <span className="flex-none text-[12px] text-text-tertiary">{t(STATUS_KEY.skipped)}</span>}
        {bad && (
          <span className="flex-none text-danger" title={t(STATUS_KEY[source.status])}>
            <Icon name="x" size={11} />
            <span className="sr-only">{t(STATUS_KEY[source.status])}</span>
          </span>
        )}
      </button>
      {bad && (
        <button
          type="button"
          onClick={() => fillComposer(t("researchRetryPrompt").replace("{url}", source.url))}
          className={`${linkClass} flex-none opacity-0 group-hover:opacity-100 focus-visible:opacity-100`}
        >
          {t("researchRetry")}
        </button>
      )}
    </div>
  );
}

function SourceList({ sources, t }: { sources: RunViewSource[]; t: (key: string) => string }) {
  return (
    <div role="list" className="grid grid-cols-[minmax(0,1fr)] ps-4">
      {sources.map((source) => <SourceRow key={source.id} source={source} t={t} />)}
    </div>
  );
}

/** The questions with the sources that answer them, then sources not tied to one yet. */
function RunTree({ run, t }: { run: ResearchRunView; t: (key: string) => string }) {
  const { groups, other } = groupSources(run);
  return (
    <div className="flex flex-col gap-1">
      <div role="list" className="flex flex-col gap-1">
        {run.questions.map((question, index) => (
          <div role="listitem" key={index}>
            <div className="flex min-h-6 items-start gap-2 text-[13px] text-text-secondary">
              <span
                aria-hidden="true"
                className={`mt-[9px] size-[6px] flex-none rounded-full ${question.notes > 0 ? "bg-text-tertiary" : "border border-rule-strong"}`}
              />
              <span className="min-w-0 flex-1 break-words pt-0.5">{question.text}</span>
              <span className="flex-none pt-0.5 text-[12px] tabular-nums text-text-tertiary">
                {count(t, question.notes, "researchRunNotesOne", "researchRunNotes")}
              </span>
            </div>
            {groups[index].length > 0 && <SourceList sources={groups[index]} t={t} />}
          </div>
        ))}
      </div>
      {other.length > 0 && (
        <div>
          <div className="min-h-6 pt-0.5 text-[12px] text-text-tertiary">{t("researchRunSourceList")}</div>
          <SourceList sources={other} t={t} />
        </div>
      )}
      {run.endedAt !== undefined && !run.notes.some((note) => note.verified !== false) && (
        <p role="note" className="m-0 flex items-start gap-2 pt-1 text-[12px] leading-[18px] text-text-tertiary">
          <span className="flex h-[18px] flex-shrink-0 items-center">
            <Icon name="warning" size={13} className="text-danger" />
          </span>
          <span>{t("researchRunNoNotes")}</span>
        </p>
      )}
    </div>
  );
}

/** A research run as one rail row: how far it got on the line, its questions and sources inside. */
export function ResearchRunCard({ step, t }: { step: SearchStep; t: (key: string) => string }) {
  const run = step.researchRun;
  const view = useTranscriptView();
  const [now, setNow] = useState(() => Date.now());
  // null follows the view: open while it runs, then folded in the normal view. A click overrides it.
  const [clicked, setClicked] = useState<boolean | null>(null);
  const live = Boolean(run) && !step.isComplete && run!.endedAt === undefined;

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);

  if (!run) return null;
  const elapsed = (run.endedAt ?? now) - run.startedAt;
  const read = run.sources.filter((source) => source.status === "read").length;
  const failed = run.sources.filter(isBad).length;
  const open = clicked ?? (live || view !== "normal");
  const parts = live
    ? [t(DEPTH_KEY[run.depth]), `${clock(elapsed)} / ${clock(run.wallMs)}`]
    : [count(t, run.questions.length, "researchRunQuestionsOne", "researchRunQuestions")];
  parts.push(count(t, read, "researchRunSourcesOne", "researchRunSources"));
  if (failed > 0) parts.push(t("researchRunFailed").replace("{n}", String(failed)));

  return (
    <div role="group" aria-label={t("researchRunTitle")}>
      <StepLine
        verb={t(live ? "researchRunLive" : "researchRunDone")}
        target={parts.join(" · ")}
        active={live}
        open={open}
        onToggle={() => setClicked(!open)}
        time={live ? undefined : <span className="ms-auto flex-none ps-2 text-[12px] tabular-nums text-text-tertiary">{clock(elapsed)}</span>}
        actions={
          live && run.gathering ? (
            <button type="button" onClick={() => stopRun(run.id)} className={linkClass}>
              {t("researchRunStop")}
            </button>
          ) : undefined
        }
        details={<RunTree run={run} t={t} />}
        t={t}
      />
    </div>
  );
}
export default ResearchRunCard;
