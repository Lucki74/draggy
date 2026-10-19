import Logo from "../../Logo";

interface EmberMarkProps {
  /** The whole square, ring included. */
  size?: number;
  /** The dragon inside it. */
  mark?: number;
}

/** The dragon in ink inside a subtle ring: the startup screen's mark. */
export function EmberMark({ size = 152, mark = 76 }: EmberMarkProps) {
  const stroke = 2;
  const radius = (size - stroke) / 2;
  return (
    <div className="relative flex flex-shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg aria-hidden viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 h-full w-full">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-rule-strong)" strokeWidth={stroke} />
      </svg>
      <span aria-hidden style={{ width: mark, height: mark }}>
        <Logo className="h-full w-full text-text-primary" />
      </span>
    </div>
  );
}
