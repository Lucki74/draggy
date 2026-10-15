import { useEffect, useRef } from "react";
import { EMBER_BUDGET } from "./emberBudget";

/** Short-lived particles rising off a source, cooling along the ember ramp as they go. One input,
 * heat from 0 to 1, drives how many are born, how fast they rise and how bright they burn.
 *
 * Mounted in Talk and on the startup screen and nowhere else (section 4.2). The loop stops while
 * the canvas is off-screen or the window is hidden or blurred, and reduced motion gets one still
 * frame. */

export interface EmbersProps {
  /** Read every frame, so a microphone level never goes through React. */
  heat: () => number;
  /** Where embers are born. A line across the bottom by default, or points sampled elsewhere. */
  source?: { kind: "line"; y?: number; spread?: number } | { kind: "points"; points: () => { x: number; y: number }[] };
  /** Fewer particles while the model generates, when the GPU is busiest (R1). */
  budget?: number;
  className?: string;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
}

const MAX_DPR = 2;
const SPAWN_PER_SECOND = 70;

const reducedMotion = () =>
  typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

function parseColor(value: string): [number, number, number] {
  const hex = value.trim().match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = value.match(/\d+(\.\d+)?/g);
  return rgb && rgb.length >= 3 ? [Number(rgb[0]), Number(rgb[1]), Number(rgb[2])] : [231, 92, 0];
}

function mix(a: [number, number, number], b: [number, number, number], t: number) {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as [number, number, number];
}

/** Hot at birth, cooling through the ramp; in light theme the last stretch is ash. */
function colorAt(ramp: [number, number, number][], t: number) {
  const span = ramp.length - 1;
  const at = Math.min(span - 0.0001, Math.max(0, t * span));
  const i = Math.floor(at);
  return mix(ramp[i], ramp[i + 1], at - i);
}

export function Embers({ heat, source = { kind: "line" }, budget = EMBER_BUDGET.idle, className = "" }: EmbersProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const heatRef = useRef(heat);
  const budgetRef = useRef(budget);
  const sourceRef = useRef(source);
  useEffect(() => {
    heatRef.current = heat;
    budgetRef.current = budget;
    sourceRef.current = source;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const particles: Particle[] = [];
    let width = 0;
    let height = 0;
    let frame = 0;
    let last = 0;
    let owed = 0;
    let onScreen = true;
    let ramp: [number, number, number][] = [];
    let additive = false;

    const readTheme = () => {
      const style = getComputedStyle(canvas);
      const dark = document.body.classList.contains("dark");
      const hot = parseColor(style.getPropertyValue("--ember-1"));
      const mid = parseColor(style.getPropertyValue("--ember-2"));
      const cool = parseColor(style.getPropertyValue("--ember-3"));
      // A glow on white reads as a smudge, so in daylight the embers cool to ash instead.
      ramp = dark ? [hot, mid, cool] : [hot, mid, cool, parseColor(style.getPropertyValue("--text-tertiary"))];
      additive = dark;
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const origin = () => {
      const src = sourceRef.current;
      if (src.kind === "points") {
        const points = src.points();
        if (points.length) return points[Math.floor(Math.random() * points.length)];
      }
      const line = src.kind === "line" ? src : { y: undefined, spread: undefined };
      const spread = line.spread ?? 0.5;
      return {
        x: width * (0.5 + (Math.random() - 0.5) * spread),
        y: height * (line.y ?? 0.96),
      };
    };

    const spawn = (level: number) => {
      const at = origin();
      particles.push({
        x: at.x,
        y: at.y,
        vx: (Math.random() - 0.5) * 14,
        vy: -(18 + Math.random() * 34) * (0.6 + level),
        age: 0,
        life: 1.1 + Math.random() * 1.4,
        size: 0.8 + Math.random() * 1.6,
      });
    };

    const paint = (level: number) => {
      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = additive ? "lighter" : "source-over";
      for (const p of particles) {
        const t = p.age / p.life;
        const [r, g, b] = colorAt(ramp, t);
        const alpha = (1 - t) * (0.35 + 0.65 * level);
        context.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
        context.beginPath();
        context.arc(p.x, p.y, p.size * (1 - t * 0.5), 0, Math.PI * 2);
        context.fill();
      }
    };

    const step = (now: number) => {
      frame = requestAnimationFrame(step);
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
      last = now;
      const level = Math.max(0, Math.min(1, heatRef.current()));

      owed += dt * SPAWN_PER_SECOND * level;
      while (owed >= 1 && particles.length < budgetRef.current) {
        spawn(level);
        owed -= 1;
      }
      if (particles.length >= budgetRef.current) owed = 0;

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.age += dt;
        if (p.age >= p.life) {
          particles.splice(i, 1);
          continue;
        }
        // A little drift, so a column of sparks never looks ruled.
        p.vx += (Math.random() - 0.5) * 30 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      paint(level);
    };

    const running = () => frame !== 0;
    const start = () => {
      if (running() || reducedMotion() || document.hidden || !onScreen) return;
      last = 0;
      frame = requestAnimationFrame(step);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };

    /** Reduced motion: one frame of embers in mid-air, at the heat of the moment. */
    const still = () => {
      particles.length = 0;
      const level = Math.max(0.3, Math.min(1, heatRef.current()));
      const count = Math.round(budgetRef.current * 0.4);
      for (let i = 0; i < count; i++) {
        spawn(level);
        const p = particles[particles.length - 1];
        p.age = Math.random() * p.life * 0.8;
        p.x += p.vx * p.age;
        p.y += p.vy * p.age;
      }
      paint(level);
    };

    readTheme();
    resize();
    if (reducedMotion()) still();
    else if (document.hasFocus()) start();

    const observer = new ResizeObserver(() => {
      resize();
      if (reducedMotion()) still();
    });
    observer.observe(canvas);

    const visibility = new IntersectionObserver(([entry]) => {
      onScreen = entry?.isIntersecting ?? true;
      if (onScreen) start();
      else stop();
    });
    visibility.observe(canvas);

    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", stop);
    window.addEventListener("focus", start);

    const theme = new MutationObserver(readTheme);
    theme.observe(document.body, { attributes: true, attributeFilter: ["class"] });

    return () => {
      stop();
      observer.disconnect();
      visibility.disconnect();
      theme.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", stop);
      window.removeEventListener("focus", start);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className={`pointer-events-none block ${className}`} />;
}
