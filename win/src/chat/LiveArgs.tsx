import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { hostnameOf } from "../utils";
import type { SearchStep } from "../types";
import { advanceReveal, type RevealState } from "./streamReveal";

/** A value longer than this, or with a line break, goes in the tail box instead of a row. */
const SHORT_VALUE = 80;
/** A burst that has not finished showing after this long is shown whole. */
const REPLAY_CAP_MS = 600;

/** The text of a streamed value as it should read now: revealed word by word, whole once it is done. */
function useRevealed(text: string, live: boolean): string {
  const [position, setPosition] = useState(live ? 0 : text.length);
  const state = useRef<RevealState>({ position: live ? 0 : text.length, budget: 0 });

  useEffect(() => {
    if (!live) return;
    let frame = 0;
    let last = performance.now();
    const startedAt = last;
    const tick = (now: number) => {
      const elapsed = Math.min(64, now - last);
      last = now;
      const next: RevealState =
        now - startedAt > REPLAY_CAP_MS
          ? { position: text.length, budget: 0 }
          : advanceReveal(text, state.current, elapsed, true);
      state.current = next;
      setPosition(next.position);
      if (next.position < text.length) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, live]);

  // A value that is no longer live is shown whole at once.
  if (!live) return text;
  return text.slice(0, Math.min(position, text.length));
}

/** A long value in a fixed-height box that follows its newest line, unless the reader scrolled up. */
export function TailBox({ text, open }: { text: string; open: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useLayoutEffect(() => {
    const el = box.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [text]);

  return (
    <div
      ref={box}
      data-testid="live-args-tail"
      data-open={open ? "true" : "false"}
      onScroll={(event) => {
        const el = event.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
      }}
      className={`live-args-tail mt-1.5 h-[164px] overflow-y-auto overflow-x-hidden rounded-[8px] border border-rule bg-surface-base px-3 py-2.5 font-mono text-[12.5px] leading-[1.6] text-text-secondary whitespace-pre-wrap break-words ${open ? "live-args-fade" : ""}`}
    >
      {text}
    </div>
  );
}

/** "search_web" reads as "Search". */
function toolLabel(tool: string | undefined): string {
  const word = (tool ?? "").split(/[_\s-]/)[0];
  return word ? word[0].toUpperCase() + word.slice(1) : "…";
}

type Entry = NonNullable<SearchStep["liveArgs"]>["entries"][number];

const isLong = (entry: Entry) => entry.value.length > SHORT_VALUE || entry.value.includes("\n");

function ShortValue({ entry, live }: { entry: Entry; live: boolean }) {
  return <>{useRevealed(entry.value, live && entry.open)}</>;
}

function LongValue({ entry, live }: { entry: Entry; live: boolean }) {
  return <TailBox text={useRevealed(entry.value, live && entry.open)} open={entry.open} />;
}

/** A tool call the model is still writing, as one rail line: the verb, then its arguments so far. */
export default function LiveArgs({ step }: { step: SearchStep }) {
  const args = step.liveArgs;
  const live = !args?.complete;
  // A page address is not a file: it reads as the site, the way the finished step does.
  const address = args?.entries.find((entry) => entry.key === "url" && entry.kind === "string");
  const site = address && (hostnameOf(address.value).replace(/^www\./i, "") || address.value);
  const short = address ? [] : (args?.entries ?? []).filter((entry) => !isLong(entry));
  const long = address ? [] : (args?.entries ?? []).filter(isLong);
  return (
    <div className="step-rise" data-testid="live-args">
      <div className="flex min-h-6 min-w-0 items-center gap-[7px] text-[14px] text-text-secondary">
        <span className="live-sweep flex-none">{toolLabel(step.tool)}</span>{" "}
        <span className="min-w-0 truncate font-mono text-[12px] text-text-tertiary">
          {site ?? (args?.invalid ? "…" : short.map((entry, index) => (
            <span key={`${index}:${entry.key}`} className="step-fade" data-kind={entry.kind}>
              {index > 0 && "  "}
              <ShortValue entry={entry} live={live} />
            </span>
          )))}
        </span>
      </div>
      {long.map((entry, index) => (
        <LongValue key={`${index}:${entry.key}`} entry={entry} live={live} />
      ))}
    </div>
  );
}
