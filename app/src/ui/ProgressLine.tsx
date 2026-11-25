export interface ProgressLineProps {
  /** 0 to 1 when the work reports how far it is; leave it out when it does not. */
  progress?: number;
  label: string;
  className?: string;
}

/** Network work in plain ink: downloads and transfers. Engine work has its own line, `Fuse`. */
export function ProgressLine({ progress, label, className = "" }: ProgressLineProps) {
  const known = typeof progress === "number" && Number.isFinite(progress);
  const value = known ? Math.max(0, Math.min(1, progress)) : undefined;

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value !== undefined ? Math.round(value * 100) : undefined}
      className={`progress-line relative h-[3px] w-full overflow-hidden rounded-pill bg-rule ${className}`}
    >
      {value !== undefined ? (
        <div className="progress-line-fill h-full rounded-pill bg-accent" style={{ width: `${value * 100}%` }} />
      ) : (
        <div className="progress-line-head" />
      )}
    </div>
  );
}
