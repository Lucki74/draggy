import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Spark } from "../ui";
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
      className={`live-args-tail mt-1.5 h-[164px] overflow-y-auto overflow-x-hidden rounded-[8px] border border-rule bg-surface-base px-3 py-2.5 font-mono text-[12.5px] leading-[1.6] text-text-secondary whitespace-pre-wrap break-words [scrollbar-width:thin] ${open ? "live-args-fade" : ""}`}
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

function ArgRow({ entry, live }: { entry: Entry; live: boolean }) {
  const shown = useRevealed(entry.value, live && entry.open);
  const long = entry.value.length > SHORT_VALUE || entry.value.includes("\n");
  if (long) {
    return (
      <>
        <dt className="col-span-2 text-text-tertiary">{entry.key}</dt>
        <dd className="col-span-2 m-0">
          <TailBox text={shown} open={entry.open} />
        </dd>
      </>
    );
  }
  return (
    <>
      <dt className="text-text-tertiary">{entry.key}</dt>
      <dd className="m-0 whitespace-pre-wrap break-words text-text-primary" data-kind={entry.kind}>
        {shown}
      </dd>
    </>
  );
}

/** A tool call the model is still writing: its name and the arguments so far. Plain text only. */
export default function LiveArgs({ step }: { step: SearchStep }) {
  const args = step.liveArgs;
  // A page address is not a file: it reads as the site, the way the finished step does.
  const address = args?.entries.find((entry) => entry.key === "url" && entry.kind === "string");
  if (address) {
    const site = hostnameOf(address.value) || address.value;
    return (
      <div className="mb-3.5 flex min-h-6 items-center gap-2 text-[13px] text-text-secondary" data-testid="live-args">
        <span className="flex w-3 justify-center">
          <Spark />
        </span>
        <span className="min-w-0 break-words">
          {toolLabel(step.tool)} {site}
        </span>
      </div>
    );
  }
  return (
    <div className="mb-3.5" data-testid="live-args">
      <div className="flex min-h-6 items-center gap-2 text-[13px] text-text-secondary">
        <span className="flex w-3 justify-center">
          <Spark />
        </span>
        <span>{toolLabel(step.tool)}</span>
      </div>
      {args?.invalid ? (
        <div className="ms-5 mt-0.5 break-words font-mono text-[12.5px] text-text-secondary">…</div>
      ) : (
        <dl className="ms-5 mt-0.5 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3.5 gap-y-0.5 font-mono text-[12.5px] leading-[1.6]">
          {args?.entries.map((entry, index) => (
            <ArgRow key={`${index}:${entry.key}`} entry={entry} live={!args.complete} />
          ))}
        </dl>
      )}
    </div>
  );
}
