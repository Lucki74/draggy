import { memo, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import { REHYPE_PLUGINS, REMARK_PLUGINS } from "./markdown";
import {
  advanceReveal,
  blockStarts,
  rehypeStreamWords,
  settledPosition,
  sharedPrefix,
} from "./streamReveal";
import type { RevealMark } from "./streamReveal";

/** A stream quiet for this long has its last word shown, rather than held back waiting for a space. */
const QUIET_MS = 400;

const prefersLessMotion = () =>
  typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

interface Shown {
  source: string;
  /** How far the reveal has got. */
  position: number;
  /** How much of that has finished fading in. */
  settled: number;
}

interface Blocks {
  source: string;
  starts: number[];
}

interface Timing extends Shown {
  budget: number;
  marks: RevealMark[];
}

interface StreamingMarkdownProps {
  source: string;
  /** More text is still coming. */
  streaming: boolean;
  /** Whether text already there when this mounts is revealed too, or shown as it is. */
  animateOnMount: boolean;
  components?: Components;
}

/** One top-level block. A finished one renders once; the one being written gets its new words
 * wrapped so they fade in. */
const MarkdownBlock = memo(function MarkdownBlock({
  source,
  from,
  components,
}: {
  source: string;
  from: number | null;
  components?: Components;
}) {
  const rehypePlugins = useMemo(
    () =>
      from === null ? REHYPE_PLUGINS : [...(REHYPE_PLUGINS as unknown[]), [rehypeStreamWords, { from }]],
    [from],
  );

  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={rehypePlugins as never}
      components={components}
    >
      {source}
    </ReactMarkdown>
  );
});

/** Markdown that arrives a word at a time. Each frame reveals what the pace allows, and only the
 * block still being written is rendered again. */
export default function StreamingMarkdown({
  source,
  streaming,
  animateOnMount,
  components,
}: StreamingMarkdownProps) {
  const [shown, setShown] = useState<Shown>(() => {
    const start = animateOnMount && !prefersLessMotion() ? 0 : source.length;
    return { source, position: start, settled: start };
  });

  // A stream rewritten rather than extended starts again from where the two versions agree.
  let view = shown;
  if (shown.source !== source) {
    const agreed = Math.min(shown.position, sharedPrefix(shown.source, source));
    view = { source, position: agreed, settled: Math.min(shown.settled, agreed) };
    setShown(view);
  }

  const [parsed, setParsed] = useState<Blocks>(() => ({ source, starts: blockStarts(source) }));

  // Parsed again from the last blocks only: the ones before them cannot change any more.
  let blocks = parsed;
  if (parsed.source !== source) {
    blocks = { source, starts: blockStarts(source, parsed) };
    setParsed(blocks);
  }

  const timingRef = useRef<Timing | null>(null);

  const streamingRef = useRef(streaming);
  useEffect(() => {
    streamingRef.current = streaming;
  }, [streaming]);

  useEffect(() => {
    if (timingRef.current === null) {
      timingRef.current = {
        ...view,
        budget: 0,
        marks: [{ at: -Infinity, position: view.position }],
      };
    }
    const timing = timingRef.current;

    if (timing.source !== source) {
      const agreed = Math.min(timing.position, sharedPrefix(timing.source, source));
      timing.source = source;
      if (agreed < timing.position) {
        timing.position = agreed;
        timing.settled = Math.min(timing.settled, agreed);
        timing.marks = timing.marks.filter((mark) => mark.position <= agreed);
        if (timing.marks.length === 0) timing.marks = [{ at: -Infinity, position: agreed }];
      }
    }

    let frame = 0;
    let last = performance.now();
    const changedAt = last;

    const tick = (now: number) => {
      const elapsed = Math.min(64, now - last);
      last = now;

      const flowing = streamingRef.current && now - changedAt < QUIET_MS;
      const next = advanceReveal(source, timing, elapsed, flowing);
      let changed = false;

      if (next.position !== timing.position) {
        timing.marks.push({ at: now, position: next.position });
        changed = true;
      }
      timing.position = next.position;
      timing.budget = next.budget;

      const settled = settledPosition(timing.marks, now);
      if (settled !== timing.settled) {
        timing.settled = settled;
        // Marks before the settled one are never read again.
        const keepFrom = timing.marks.findIndex((mark) => mark.position === settled);
        if (keepFrom > 0) timing.marks = timing.marks.slice(keepFrom);
        changed = true;
      }

      if (changed) setShown({ source, position: timing.position, settled: timing.settled });

      const busy =
        streamingRef.current || timing.position < source.length || timing.settled < timing.position;
      frame = busy ? requestAnimationFrame(tick) : 0;
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // The clock restarts for each new text; how far the reveal got lives on in timingRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, streaming]);

  const end = view.position;
  const parts: { start: number; end: number }[] = [];
  for (let index = 0; index < blocks.starts.length && blocks.starts[index] < end; index++) {
    parts.push({
      start: blocks.starts[index],
      end: Math.min(blocks.starts[index + 1] ?? end, end),
    });
  }

  return (
    <>
      {parts.map((part) => (
        <MarkdownBlock
          key={part.start}
          source={source.slice(part.start, part.end)}
          from={part.end > view.settled ? Math.max(0, view.settled - part.start) : null}
          components={components}
        />
      ))}
    </>
  );
}
