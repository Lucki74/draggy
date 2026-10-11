import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import StreamingMarkdown from "./StreamingMarkdown";
import { normalizeMath } from "../utils";
import { REHYPE_PLUGINS, REMARK_PLUGINS } from "./markdown";
import { Icon, Spark } from "../ui";
import type { SearchStep } from "../types";
import { useTranscriptView } from "./transcriptView";

export interface ThinkingRowProps {
  step: SearchStep;
  live: boolean;
  isGenerating: boolean;
  t: (key: string) => string;
}

/** Whole seconds since `from`, ticking once a second while `running`. */
function useElapsed(from: number, running: boolean) {
  const [now, setNow] = useState(from);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return Math.max(0, Math.floor((now - from) / 1000));
}

// Reasoning as a disclosure row: the spark and a running count while it thinks, "Thought for 4s" after.
export function ThinkingRow({ step, live, isGenerating, t }: ThinkingRowProps) {
  const thinking = !step.isComplete;
  const [mountedAt] = useState(() => step.startedAt ?? Date.now());
  const elapsed = useElapsed(mountedAt, thinking && isGenerating);
  const view = useTranscriptView();

  // Normal view shows reasoning only while it happens.
  if (!step.content || (!thinking && view === "normal")) return null;

  const done =
    step.thoughtTime !== undefined && step.thoughtTime < 1
      ? t("thoughtForAMoment")
      : `${t("thoughtFor")} ${Math.round(step.thoughtTime ?? elapsed)}s`;

  return (
    <details key={step.id} className="mb-4 group/think" open={thinking || view === "verbose"}>
      <summary className="inline-flex items-center gap-2 h-7 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden text-[13px] text-text-secondary hover:text-text-primary rounded-xs focus-visible:outline-2 focus-visible:outline-offset-2">
        {thinking ? (
          <>
            <Spark />
            <span role="status">{t("thinking")}</span>
            <span aria-hidden="true" className="tabular-nums -ms-1">{elapsed}s</span>
          </>
        ) : (
          <span>{done}</span>
        )}
        <Icon name="caret-right" size={12} mirrored className="transition-transform group-open/think:rotate-90" />
      </summary>
      <div className="mt-1 ps-4 border-s-2 border-rule text-text-secondary text-[14px] leading-6 markdown-body [&_pre]:whitespace-pre-wrap [&_pre]:break-words">
        {live ? (
          <StreamingMarkdown
            source={normalizeMath(step.content)}
            streaming={isGenerating && thinking}
            animateOnMount={isGenerating && thinking}
          />
        ) : (
          <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS}>
            {normalizeMath(step.content)}
          </ReactMarkdown>
        )}
      </div>
    </details>
  );
}
export default ThinkingRow;
