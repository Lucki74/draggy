import { useEffect, useRef, useState, type ReactNode } from "react";

interface InViewProps {
  children: ReactNode;
  rootMargin?: string;
  estimatedHeight?: number;
  className?: string;
  forceRender?: boolean;
}

/** Skips mounting children until in or near the viewport, holding space with measured height. */
export default function InView({
  children,
  rootMargin = "300px",
  estimatedHeight = 70,
  className = "",
  forceRender = false,
}: InViewProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Default to true when IntersectionObserver is not available (Node / jsdom / unit tests).
  const [isInView, setIsInView] = useState(() => typeof IntersectionObserver === "undefined");
  const [height, setHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;

    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
        } else {
          if (node.offsetHeight > 0) setHeight(node.offsetHeight);
          setIsInView(false);
        }
      },
      { rootMargin },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [rootMargin]);

  // Not on every render: a layout read per streamed token would cost more than culling saves.
  useEffect(() => {
    if (isInView && ref.current?.offsetHeight) {
      setHeight(ref.current.offsetHeight);
    }
  }, [isInView]);

  const currentHeight = height ?? estimatedHeight;

  return (
    <div
      ref={ref}
      className={className}
      style={{
        minHeight: !isInView && !forceRender ? `${currentHeight}px` : undefined,
        contentVisibility: "auto",
        containIntrinsicSize: `auto ${currentHeight}px`,
      }}
    >
      {isInView || forceRender ? children : null}
    </div>
  );
}
