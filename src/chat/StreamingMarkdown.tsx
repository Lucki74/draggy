import { memo, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import { REHYPE_PLUGINS, REMARK_PLUGINS } from "./markdown";
import { ErrorBoundary } from "../ErrorBoundary";
import { advanceReveal, blockStarts, rehypeCaret, rehypeWordFade, sharedPrefix } from "./streamReveal";
import { rehypeVoidGuard } from "./rehypeVoid";

/** A stream quiet for this long has its last line shown, rather than held back waiting for the rest. */
const QUIET_MS = 400;

const prefersLessMotion = () =>
  typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

interface Shown {
  source: string;
  /** How far the reveal has got. */
  position: number;
}

interface Blocks {
  source: string;
  starts: number[];
}

interface Timing extends Shown {
  budget: number;
}

interface StreamingMarkdownProps {
  source: string;
  /** More text is still coming. */
  streaming: boolean;
  /** Whether text already there when this mounts is revealed too, or shown as it is. */
  animateOnMount: boolean;
  components?: Components;
}

/** One top-level block. A finished one renders once; only the one being written renders again. */
const MarkdownBlock = memo(function MarkdownBlock({
  source,
  caret,
  fade,
  components,
}: {
  source: string;
  /** The block being written, which carries the ember caret. */
  caret: boolean;
  /** Words fade in as they are added. Set for the last blocks only, to keep the tree small. */
  fade: boolean;
  components?: Components;
}) {
  // The caret goes in first, so it lands after the last word rather than inside it.
  // The void guard runs after both, so it has the final word on every tree.
  const rehypePlugins = useMemo(
    () => [
      ...(REHYPE_PLUGINS as unknown[]),
      ...(caret ? [rehypeCaret] : []),
      ...(fade ? [rehypeWordFade] : []),
      rehypeVoidGuard,
    ],
    [caret, fade],
  );

  // A block that still fails shows its text, so one bad block cannot blank the whole reply.
  // It stays as text until its key changes, so it is not reset on every streamed word.
  return (
    <ErrorBoundary fallback={<div className="whitespace-pre-wrap">{source}</div>}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={rehypePlugins as never}
        components={components}
      >
        {source}
      </ReactMarkdown>
    </ErrorBoundary>
  );
});

/** Markdown that arrives in bursts. Each frame reveals what the pace allows, and only the
 * block still being written is rendered again. */
export default function StreamingMarkdown({
  source,
  streaming,
  animateOnMount,
  components,
}: StreamingMarkdownProps) {
  const [shown, setShown] = useState<Shown>(() => {
    const start = animateOnMount && !prefersLessMotion() ? 0 : source.length;
    return { source, position: start };
  });

  // A stream rewritten rather than extended starts again from where the two versions agree.
  let view = shown;
  if (shown.source !== source) {
    const agreed = Math.min(shown.position, sharedPrefix(shown.source, source));
    view = { source, position: agreed };
    setShown(view);
  }

  // Fading is for text that arrives live, not for a reply shown as it is.
  const [animate, setAnimate] = useState(() => !prefersLessMotion() && (animateOnMount || streaming));
  if (streaming && !animate && !prefersLessMotion()) setAnimate(true);

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
      timingRef.current = { ...view, budget: 0 };
    }
    const timing = timingRef.current;

    if (timing.source !== source) {
      const agreed = Math.min(timing.position, sharedPrefix(timing.source, source));
      timing.source = source;
      timing.position = Math.min(timing.position, agreed);
    }

    let frame = 0;
    let last = performance.now();
    const changedAt = last;

    const tick = (now: number) => {
      const elapsed = Math.min(64, now - last);
      last = now;

      const flowing = streamingRef.current && now - changedAt < QUIET_MS;
      const next = advanceReveal(source, timing, elapsed, flowing);
      // Markdown is parsed again only on frames where a new line appeared.
      if (next.position !== timing.position) setShown({ source, position: next.position });
      timing.position = next.position;
      timing.budget = next.budget;

      const busy = streamingRef.current || timing.position < source.length;
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
      {parts.map((part, index) => (
        <MarkdownBlock
          key={part.start}
          source={source.slice(part.start, part.end)}
          caret={streaming && index === parts.length - 1}
          fade={animate && index >= parts.length - 2}
          components={components}
        />
      ))}
    </>
  );
}
