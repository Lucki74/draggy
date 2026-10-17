import Logo from "../../Logo";

interface EmberMarkProps {
  /** The whole square, ring included. */
  size?: number;
  /** The dragon inside it. */
  mark?: number;
}

/** The dragon in ink with an ember arc circling it: the startup screen's one moving thing. */
export function EmberMark({ size = 152, mark = 76 }: EmberMarkProps) {
  const stroke = 2;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="relative flex flex-shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg aria-hidden viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 h-full w-full">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-rule-strong)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--ember-2)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference * 0.22} ${circumference}`}
          className="origin-center animate-spin motion-reduce:animate-none"
          style={{ animationDuration: "1.1s", animationTimingFunction: "linear" }}
        />
      </svg>
      <span aria-hidden style={{ width: mark, height: mark }}>
        <Logo className="h-full w-full text-text-primary" />
      </span>
    </div>
  );
}
