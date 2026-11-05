import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
function TailBox({ text, open }: { text: string; open: boolean }) {
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
      className={`live-args-tail mt-1 max-h-[12rem] overflow-y-auto overflow-x-hidden rounded-sm border border-rule bg-surface-base p-2 font-mono text-[12px] leading-5 text-text-primary whitespace-pre-wrap break-words ${open ? "live-args-fade" : ""}`}
    >
      {text}
    </div>
  );
}

function ValueRow({ name, value, kind, open, live }: { name: string; value: string; kind: string; open: boolean; live: boolean }) {
  const shown = useRevealed(value, live && open);
  const long = value.length > SHORT_VALUE || value.includes("\n");
  return (
    <div className="mt-1 text-[12px]">
      <span className="text-text-secondary">{name}</span>
      {long ? (
        <TailBox text={shown} open={open} />
      ) : (
        <span className="ms-2 font-mono text-text-primary break-words" data-kind={kind}>
          {shown}
        </span>
      )}
    </div>
  );
}

/** A tool call the model is still writing: its name and the arguments so far. Plain text only. */
export default function LiveArgs({ step }: { step: SearchStep }) {
  const args = step.liveArgs;
  return (
    <div className="ps-6 mt-1" data-testid="live-args">
      <div className="font-mono text-[12px] text-text-secondary">{step.tool ?? "…"}</div>
      {args?.invalid ? (
        <div className="mt-1 font-mono text-[12px] text-text-secondary break-words">…</div>
      ) : (
        args?.entries.map((entry, index) => (
          <ValueRow
            key={`${index}:${entry.key}`}
            name={entry.key}
            value={entry.value}
            kind={entry.kind}
            open={entry.open}
            live={!args.complete}
          />
        ))
      )}
    </div>
  );
}
