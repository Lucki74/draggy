import type { ComponentType } from "react";

/** An icon struck through in amber: what the composer shows for a control the model cannot use. */
export default function CrossedIcon({
  icon: Icon,
  className = "w-3.5 h-3.5",
}: {
  icon: ComponentType<{ className?: string }>;
  className?: string;
}) {
  return (
    <span data-testid="crossed-icon" aria-hidden="true" className="relative inline-flex flex-shrink-0 text-amber-500">
      <Icon className={className} />
      <svg viewBox="0 0 24 24" className="absolute inset-0 w-full h-full" fill="none" stroke="currentColor">
        <line x1="3" y1="3" x2="21" y2="21" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </span>
  );
}
