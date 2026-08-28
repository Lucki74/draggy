import { useEffect, useRef } from "react";
import type { Activity } from "./conversation";

/**
 * The thing you look at while you talk.
 *
 * One filled circle, one colour, no gradient and no glow: dark on a light
 * theme, white on a dark one. Everything it has to say it says with size and
 * with a single stroked arc, because a shape that only changes size stays
 * legible at a glance from across a room, which is how voice mode is used.
 *
 * The microphone level arrives about thirty times a second, far too often to
 * put through React. It is pulled from the conversation inside an animation
 * frame and written straight to the DOM, so the orb tracks a voice closely
 * while the transcript underneath it stays still.
 */

interface OrbProps {
  activity: Activity;
  muted: boolean;
  live: boolean;
  /** Reads the current microphone level, 0 to about 0.5. */
  level: () => number;
}

/** Rise quickly with the voice, fall back slowly, so it never looks jittery. */
const ATTACK = 0.45;
const RELEASE = 0.12;

const BASE_RADIUS = 46;
const SWELL = 22;
/** Where the circle settles while it is the model's turn to work. */
const BUSY_RADIUS = 26;

const BREATH_MS = 4200;
const SPEAK_MS = 1500;

/** Far enough out that a swollen circle never touches it. */
const ARC_RADIUS = 70;
/** Roughly a fifth of the circumference, so the gap reads as motion. */
const ARC_DASH = `${Math.round(2 * Math.PI * ARC_RADIUS * 0.2)} ${Math.round(
  2 * Math.PI * ARC_RADIUS,
)}`;

export default function Orb({ activity, muted, live, level }: OrbProps) {
  const coreRef = useRef<SVGCircleElement>(null);
  const arcRef = useRef<SVGCircleElement>(null);

  // The loop starts once and reads these, so it never has to be torn down and
  // rebuilt when the conversation changes state.
  const activityRef = useRef(activity);
  const mutedRef = useRef(muted);
  const liveRef = useRef(live);

  useEffect(() => {
    activityRef.current = activity;
    mutedRef.current = muted;
    liveRef.current = live;
  }, [activity, muted, live]);

  useEffect(() => {
    let frame = 0;
    let smoothed = 0;
    let busy = 0;
    const started = performance.now();

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);

      const state = activityRef.current;
      const elapsed = now - started;
      const working = state === "thinking" || state === "searching";

      // While the assistant talks there is no microphone level worth showing,
      // so a steady pulse stands in for it.
      const target =
        !liveRef.current || mutedRef.current || working
          ? 0
          : state === "speaking"
            ? 0.3 + 0.14 * Math.sin((elapsed / SPEAK_MS) * Math.PI * 2)
            : Math.min(1, level() * 7);

      smoothed += (target - smoothed) * (target > smoothed ? ATTACK : RELEASE);
      busy += ((working ? 1 : 0) - busy) * 0.12;

      const breath = Math.sin((elapsed / BREATH_MS) * Math.PI * 2);
      const idle = liveRef.current ? 1.1 : 2.4;

      const open = BASE_RADIUS + smoothed * SWELL + breath * idle;
      const radius = open + (BUSY_RADIUS - open) * busy;

      if (coreRef.current) {
        coreRef.current.setAttribute("r", radius.toFixed(2));
      }
      if (arcRef.current) {
        arcRef.current.setAttribute("opacity", busy.toFixed(3));
        arcRef.current.setAttribute(
          "transform",
          `rotate(${(elapsed * 0.12).toFixed(1)} 100 100)`,
        );
      }
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [level]);

  return (
    <svg
      viewBox="0 0 200 200"
      className="w-56 h-56 flex-shrink-0 overflow-visible"
      aria-hidden="true"
    >
      <circle
        ref={arcRef}
        cx="100"
        cy="100"
        r={ARC_RADIUS}
        fill="none"
        stroke="var(--orb)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={ARC_DASH}
        opacity="0"
      />

      <circle
        ref={coreRef}
        cx="100"
        cy="100"
        r={BASE_RADIUS}
        fill={muted ? "none" : "var(--orb)"}
        stroke={muted ? "var(--orb)" : "none"}
        strokeWidth="2"
        opacity={live ? 1 : 0.85}
        style={{ transition: "opacity 400ms ease" }}
      />
    </svg>
  );
}
