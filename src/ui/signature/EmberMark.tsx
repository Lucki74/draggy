import { useCallback, useEffect, useRef } from "react";
import Logo from "../../Logo";
import { Embers } from "./Embers";
import { markOutline } from "./markOutline";

interface EmberMarkProps {
  /** Read every frame. 0 leaves the dragon in plain ink. */
  heat: () => number;
  /** The whole square, embers included. */
  size?: number;
  /** The dragon inside it. */
  mark?: number;
}

/** The dragon in ink with embers rising off its outline: the startup screen's one moving thing. */
export function EmberMark({ heat, size = 224, mark = 96 }: EmberMarkProps) {
  const outlineRef = useRef<{ x: number; y: number }[]>([]);
  const inset = (size - mark) / 2;
  // Embers rise, so the dragon sits below centre and leaves them room above.
  const lift = inset * 0.35;

  useEffect(() => {
    let alive = true;
    void markOutline().then((points) => {
      if (!alive) return;
      outlineRef.current = points.map((p) => ({ x: inset + p.x * mark, y: inset + lift + p.y * mark }));
    });
    return () => {
      alive = false;
    };
  }, [inset, lift, mark]);

  const points = useCallback(() => outlineRef.current, []);
  // Nothing is born until the outline is known, or the first embers would come off the bottom edge.
  const burning = useCallback(() => (outlineRef.current.length ? heat() : 0), [heat]);

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <Embers heat={burning} source={{ kind: "points", points }} budget={70} className="absolute inset-0 h-full w-full" />
      {/* Same offsets as the outline, so the drawn edge and the sampled one coincide. */}
      <span aria-hidden className="absolute" style={{ left: inset, top: inset + lift, width: mark, height: mark }}>
        <Logo className="h-full w-full text-text-primary" />
      </span>
    </div>
  );
}
