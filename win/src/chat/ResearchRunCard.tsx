import { useEffect, useState } from "react";
import { Icon } from "../ui";
import SiteBadge from "./SiteBadge";
import { hostnameOf } from "../utils";
import { stopRun } from "../research/session";
import type { Depth, SourceStatus } from "../research/run";
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

const STATUS_TONE: Record<SourceStatus, string> = {
  reading: "text-accent-ink",
  read: "text-ok",
  skipped: "text-text-tertiary",
  blocked: "text-danger",
  failed: "text-danger",
};

/** 125000 ms as 2:05. */
function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Dates arrive as the page wrote them; a full timestamp is cut to its day. */
function dayOf(published: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(published) ? published.slice(0, 10) : published;
}

export function ResearchRunCard({ step, t }: { step: SearchStep; t: (key: string) => string }) {
  const run = step.researchRun;
  const [now, setNow] = useState(() => Date.now());
  const ticking = Boolean(run) && !step.isComplete && run!.endedAt === undefined;

  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);

  if (!run) return null;
  const elapsed = (run.endedAt ?? now) - run.startedAt;
  const read = run.sources.filter((source) => source.status === "read").length;
  const canStop = ticking && run.gathering;

  return (
    <div
      role="group"
      aria-label={t("researchRunTitle")}
      className="mb-4 overflow-hidden rounded-md border border-rule-strong bg-surface-base"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule px-4 py-2 text-[12px] text-text-secondary">
        <span className="flex items-center gap-2 text-accent-ink">
          <Icon name="magnifying-glass" size={14} className="flex-shrink-0" />
          <span className="font-medium">{t("researchRunTitle")}</span>
        </span>
        <span>{t(DEPTH_KEY[run.depth])}</span>
        <span className="tabular-nums">
          {clock(elapsed)} / {clock(run.wallMs)}
        </span>
        <span className="tabular-nums">{t("researchRunSources").replace("{n}", String(read))}</span>
        {canStop && (
          <button
            type="button"
            onClick={() => stopRun(run.id)}
            className="ms-auto inline-flex items-center gap-1.5 rounded-sm border border-rule px-2 py-0.5 text-text-primary outline-none hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-focus"
          >
            <Icon name="stop" size={12} />
            {t("researchRunStop")}
          </button>
        )}
      </div>

      <ul className="m-0 flex list-none flex-col gap-1 p-4 pb-2">
        {run.questions.map((question, index) => (
          <li key={index} className="flex items-start gap-2 text-[13px]">
            <span className="flex w-3 flex-shrink-0 justify-center pt-1">
              {question.notes > 0 ? (
                <Icon name="check" size={12} className="text-ok" />
              ) : (
                <span aria-hidden="true" className="mt-1 block h-2 w-2 rounded-full border border-rule-strong" />
              )}
            </span>
            <span className="min-w-0 flex-1 break-words text-text-primary">{question.text}</span>
            <span className="flex-shrink-0 text-[12px] tabular-nums text-text-tertiary">
              {t("researchRunNotes").replace("{n}", String(question.notes))}
            </span>
          </li>
        ))}
      </ul>

      {run.sources.length > 0 && (
        <div className="flex max-h-64 flex-col overflow-y-auto px-2 pb-1">
          {run.sources.map((source) => {
            const host = hostnameOf(source.url);
            const title = source.title === source.url ? host || source.url : source.title;
            return (
              <button
                key={source.id}
                type="button"
                title={host}
                onClick={() => window.open(source.url, "_blank")}
                className="flex items-start gap-3 rounded-sm px-2 py-1.5 text-start outline-none hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-focus"
              >
                <SiteBadge hostname={host} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] leading-5 text-text-primary">{title}</span>
                  <span className="block truncate text-[12px] text-text-tertiary">
                    {[source.site || host, source.published ? dayOf(source.published) : ""].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className={`flex-shrink-0 pt-0.5 text-[12px] ${STATUS_TONE[source.status]}`}>
                  {t(STATUS_KEY[source.status])}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {run.hosts.length > 0 && (
        <p className="m-0 break-words border-t border-rule px-4 py-2 text-[12px] text-text-tertiary">
          {t("researchRunServices").replace("{hosts}", run.hosts.join(", "))}
        </p>
      )}
    </div>
  );
}
export default ResearchRunCard;
