import type { CostDay } from "./costSummary";

const WIDTH = 600;
const HEIGHT = 140;
const BASELINE = HEIGHT - 18;
const TOP = 8;

interface CostChartProps {
  days: CostDay[];
  /** Micro-dollars as the page's money text. */
  format: (micros: number) => string;
  ariaLabel: string;
  spentLabel: string;
  accountLabel: string;
}

/** Cost per day: what was billed in ink, with the value of plan-covered replies stacked above it in a quieter
 * neutral. Plain SVG, no chart library; every bar carries its figure as a title for hover and screen readers. */
export default function CostChart({ days, format, ariaLabel, spentLabel, accountLabel }: CostChartProps) {
  const peak = Math.max(1, ...days.map((entry) => entry.spentMicros + entry.accountMicros));
  const slot = WIDTH / Math.max(1, days.length);
  const bar = Math.max(1, Math.min(28, slot * 0.7));
  const scale = (BASELINE - TOP) / peak;

  // Label the first, middle and last day: enough to place the bars without crowding a 90 day axis.
  const labelled = new Set([0, Math.floor((days.length - 1) / 2), days.length - 1]);

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={ariaLabel} className="h-auto w-full">
      <line x1="0" x2={WIDTH} y1={BASELINE} y2={BASELINE} stroke="var(--rule-strong)" />
      {days.map((entry, index) => {
        const x = index * slot + (slot - bar) / 2;
        const spentHeight = entry.spentMicros * scale;
        const accountHeight = entry.accountMicros * scale;
        return (
          <g key={entry.day}>
            <title>
              {`${entry.day}: ${spentLabel} ${format(entry.spentMicros)}${entry.accountMicros > 0 ? `, ${accountLabel} ${format(entry.accountMicros)}` : ""}`}
            </title>
            {spentHeight > 0 && (
              <rect x={x} y={BASELINE - spentHeight} width={bar} height={spentHeight} rx="1.5" fill="var(--text-primary)" />
            )}
            {accountHeight > 0 && (
              <rect
                x={x}
                y={BASELINE - spentHeight - accountHeight}
                width={bar}
                height={accountHeight}
                rx="1.5"
                fill="var(--text-tertiary)"
              />
            )}
            {labelled.has(index) && (
              <text
                x={x + bar / 2}
                y={HEIGHT - 4}
                fontSize="10"
                fill="var(--text-tertiary)"
                textAnchor={index === 0 ? "start" : index === days.length - 1 ? "end" : "middle"}
              >
                {entry.day.slice(5)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
