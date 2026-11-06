import { useState } from "react";
import { hueFor, siteLabel } from "../utils";

// Hostname-based icon or fallback letter to protect user privacy.
export function SiteBadge({ hostname }: { hostname: string }) {
  const label = siteLabel(hostname);
  const hue = hueFor(label);

  // Tracks host errors so reused rows retry instead of sticking to missing icons.
  const [failedFor, setFailedFor] = useState<string | null>(null);

  if (hostname && failedFor !== hostname) {
    return (
      <img
        src={`draggy://favicon/${encodeURIComponent(hostname)}`}
        alt=""
        aria-hidden="true"
        loading="lazy"
        onError={() => setFailedFor(hostname)}
        className="w-5 h-5 rounded-sm flex-shrink-0 mt-0.5 object-contain select-none"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="w-5 h-5 rounded-sm flex-shrink-0 mt-0.5 flex items-center justify-center text-[10px] font-semibold select-none"
      style={{
        backgroundColor: `hsl(${hue} 62% 46%)`,
        color: "white",
      }}
    >
      {label.slice(0, 1)}
    </span>
  );
}
export default SiteBadge;
