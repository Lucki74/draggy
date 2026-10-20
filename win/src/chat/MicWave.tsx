import { useEffect, useRef } from "react";

const BARS = 12;
const BAR_WIDTH = 2;
const GAP = 3;
const HEIGHT = 18;
const WIDTH = BARS * (BAR_WIDTH + GAP) - GAP;

/** A small live level meter for dictation: thin bars that rise with the voice and rest as dots in silence. */
export function MicWave({ analyser }: { analyser: AnalyserNode }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;

    const ratio = window.devicePixelRatio || 1;
    element.width = WIDTH * ratio;
    element.height = HEIGHT * ratio;
    context.scale(ratio, ratio);

    const data = new Uint8Array(analyser.frequencyBinCount);
    const levels = new Float32Array(BARS);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;

    const draw = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const sample of data) peak = Math.max(peak, Math.abs(sample - 128) / 128);
      const level = Math.min(1, peak * 2.4);

      // New level enters on the right and scrolls left, so the strip reads as a short history.
      levels.copyWithin(0, 1);
      levels[BARS - 1] = reduced ? level * 0.5 : level;

      context.clearRect(0, 0, WIDTH, HEIGHT);
      context.fillStyle = getComputedStyle(element).color;
      for (let i = 0; i < BARS; i++) {
        const h = Math.max(2, levels[i] * HEIGHT);
        context.globalAlpha = 0.45 + 0.55 * (i / (BARS - 1));
        context.fillRect(i * (BAR_WIDTH + GAP), (HEIGHT - h) / 2, BAR_WIDTH, h);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [analyser]);

  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      style={{ width: WIDTH, height: HEIGHT }}
      className="ms-2 me-1 shrink-0 text-text-secondary"
    />
  );
}
