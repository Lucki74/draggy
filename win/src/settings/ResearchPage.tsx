import { useEffect, useMemo, useState } from "react";
import { Button, Page } from "./Controls";
import StreamingMarkdown from "../chat/StreamingMarkdown";
import { Icon } from "../ui/icons/Icon";
import { swallowed } from "../logger";
import { hostnameOf } from "../utils";
import { followUpTarget, reportOf, runsMatching, type FollowUp } from "../research/libraryView";
import type { RunHit, RunSummary, SavedRun } from "../research/library";
import type { ChatSession } from "../types";

type Translate = (key: string) => string;

const DEPTH_LABEL = { quick: "researchDepthQuick", standard: "researchDepthStandard", deep: "researchDepthDeep" } as const;
const swallowedCall = swallowed("research", "the main process already logged this call");

interface Props {
  sessions: ChatSession[];
  onFollowUp: (target: FollowUp) => void;
  t: Translate;
}

/** Finished research runs: a searchable list, and one run opened to its report, sources and notes. */
export function ResearchPage({ sessions, onFollowUp, t }: Props) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<RunHit[] | null>(null);
  const [open, setOpen] = useState<SavedRun | null>(null);

  useEffect(() => {
    window.draggy?.research?.list().then((result) => setRuns(result?.runs ?? [])).catch(swallowedCall);
  }, []);

  useEffect(() => {
    if (!query.trim()) return;
    let live = true;
    const timer = setTimeout(() => {
      window.draggy?.research
        ?.search(query)
        .then((result) => live && setHits(result?.hits ?? []))
        .catch(swallowedCall);
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  const shown = useMemo(() => (query.trim() && hits ? runsMatching(runs, hits) : runs), [runs, hits, query]);
  const snippetOf = (id: string) => (query.trim() ? hits : null)?.find((hit) => hit.runId === id)?.snippet;

  const show = (id: string) => {
    window.draggy?.research?.get(id).then((result) => result?.run && setOpen(result.run)).catch(swallowedCall);
  };

  if (open) return <RunDetail run={open} sessions={sessions} onBack={() => setOpen(null)} onFollowUp={onFollowUp} t={t} />;

  return (
    <Page title={t("researchPage")}>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("researchSearchPlaceholder")}
        aria-label={t("researchSearchPlaceholder")}
        className="h-8 w-full rounded-sm bg-surface-base px-3 text-[13px] text-text-primary shadow-[inset_0_0_0_1px_var(--rule-control)] placeholder:text-text-tertiary outline-none focus-visible:ring-2 focus-visible:ring-focus"
        spellCheck={false}
      />
      {shown.length === 0 ? (
        <p className="text-[13px] text-text-secondary">{t(query.trim() ? "researchNoMatch" : "researchEmpty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-rule">
          {shown.map((run) => (
            <li key={run.id}>
              <button
                type="button"
                onClick={() => show(run.id)}
                className="flex w-full flex-col gap-0.5 rounded-sm px-2 py-2 text-start outline-none hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-focus"
              >
                <span className="truncate text-[14px] text-text-primary">{run.question}</span>
                <span className="text-[12px] text-text-tertiary">
                  {[new Date(run.startedAt).toLocaleDateString(), t(DEPTH_LABEL[run.depth]), t("researchRunSources").replace("{n}", String(run.sourceCount))].join(" · ")}
                </span>
                {snippetOf(run.id) && <span className="line-clamp-2 text-[12px] text-text-secondary">{snippetOf(run.id)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

function RunDetail({ run, sessions, onBack, onFollowUp, t }: { run: SavedRun; sessions: ChatSession[]; onBack: () => void; onFollowUp: Props["onFollowUp"]; t: Translate }) {
  const report = reportOf(run, sessions);
  return (
    <Page title={run.question}>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 rounded-sm text-[13px] text-text-secondary outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-focus"
        >
          <Icon name="arrow-left" size={14} />
          {t("researchBack")}
        </button>
        <Button tone="primary" onClick={() => onFollowUp(followUpTarget(run, sessions))}>
          {t("researchFollowUp")}
        </Button>
      </div>

      <section aria-label={t("researchReport")}>
        <h3 className="mb-1 text-[13px] font-medium text-text-secondary">{t("researchReport")}</h3>
        {report ? (
          <StreamingMarkdown source={report} streaming={false} animateOnMount={false} />
        ) : (
          <p className="text-[13px] text-text-secondary">{t("researchReportGone")}</p>
        )}
      </section>

      <section aria-label={t("researchSourceList")}>
        <h3 className="mb-1 text-[13px] font-medium text-text-secondary">{t("researchSourceList")}</h3>
        <ul className="flex flex-col">
          {run.sources.map((source) => (
            <li key={source.id}>
              <button
                type="button"
                onClick={() => window.open(source.url, "_blank")}
                className="flex w-full flex-col rounded-sm px-1 py-1 text-start outline-none hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-focus"
              >
                <span className="truncate text-[13px] text-text-primary">{source.title || source.url}</span>
                <span className="truncate text-[12px] text-text-tertiary">{source.site || hostnameOf(source.url)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label={t("researchNotesTitle")}>
        <h3 className="mb-1 text-[13px] font-medium text-text-secondary">{t("researchNotesTitle")}</h3>
        <ul className="flex flex-col gap-2">
          {run.notes.map((note) => (
            <li key={note.id} className="text-[13px] leading-5">
              <span className="text-text-primary">{note.claim}</span>
              {note.verified && <span className="ms-2 text-[12px] text-text-tertiary">{t("researchVerified")}</span>}
              <blockquote className="border-s-2 border-rule ps-2 text-[12px] text-text-secondary">{note.quote}</blockquote>
            </li>
          ))}
        </ul>
      </section>
    </Page>
  );
}
