import { useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import StreamingMarkdown from "./StreamingMarkdown";
import { normalizeMath } from "../utils";
import { REHYPE_PLUGINS, REMARK_PLUGINS } from "./markdown";
import type { SearchStep } from "../types";
import { useTranscriptView } from "./transcriptView";

export interface ThinkingRowProps {
  step: SearchStep;
  live: boolean;
  isGenerating: boolean;
  /** Inside the step chain: muted text between the tool rows, always shown. */
  inline?: boolean;
  t: (key: string) => string;
}

/** A thought while it streams: only its newest lines, the top fading once there are more. */
function ThoughtTail({ children }: { children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  useLayoutEffect(() => {
    const el = box.current;
    if (el) setOver(el.scrollHeight > el.clientHeight + 1);
  }, [children]);
  return (
    <div ref={box} className={`thought thought-tail soft-words markdown-body [&_p]:mb-0${over ? " is-over" : ""}`}>
      <div>{children}</div>
    </div>
  );
}

/** A finished thought as one plain line: markdown marks dropped, whitespace folded. */
function excerpt(text: string) {
  return text.replace(/[`*_#>~[\]]/g, "").replace(/\s+/g, " ").trim();
}

// Reasoning as plain muted text on the rail, like any other step: no disclosure, no timer.
export function ThinkingRow({ step, live, isGenerating, inline = false }: ThinkingRowProps) {
  const thinking = !step.isComplete;
  const view = useTranscriptView();

  // Normal view shows reasoning only while it happens.
  if (!step.content || (!inline && !thinking && view === "normal")) return null;
  // The normal view keeps a thought short: its tail while it streams, one line once done.
  if (view === "normal" && !thinking) {
    return <div className="thought thought-brief">{excerpt(step.content)}</div>;
  }
  const prose = live && thinking ? (
    <StreamingMarkdown source={normalizeMath(step.content)} streaming={isGenerating} animateOnMount={isGenerating} />
  ) : (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS}>
      {normalizeMath(step.content)}
    </ReactMarkdown>
  );
  if (view === "normal") return <ThoughtTail>{prose}</ThoughtTail>;
  return (
    <div key={step.id} className={`thought step-rise soft-words markdown-body [&_p]:mb-2 [&_p:last-child]:mb-0 [&_pre]:whitespace-pre-wrap [&_pre]:break-words${inline ? "" : " mb-3.5"}`}>
      {prose}
    </div>
  );
}
export default ThinkingRow;
