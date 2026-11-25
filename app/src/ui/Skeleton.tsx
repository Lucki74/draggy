/** Placeholder pulse block for loading states in lists and cards. */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-sm bg-surface-raised ${className}`}
    />
  );
}
