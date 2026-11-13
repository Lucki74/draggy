import { draggyUrl } from "../appUrl";
import { useState } from "react";
import { hueFor, siteLabel } from "../utils";

// Hostname-based icon or fallback letter to protect user privacy.
export function SiteBadge({ hostname, small = false }: { hostname: string; small?: boolean }) {
  const label = siteLabel(hostname);
  const hue = hueFor(label);
  const box = small ? "size-4 text-[9px]" : "w-5 h-5 mt-0.5 text-[10px]";

  // Tracks host errors so reused rows retry instead of sticking to missing icons.
  const [failedFor, setFailedFor] = useState<string | null>(null);

  if (hostname && failedFor !== hostname) {
    return (
      <img
        src={draggyUrl(`favicon/${encodeURIComponent(hostname)}`)}
        alt=""
        aria-hidden="true"
        loading="lazy"
        onError={() => setFailedFor(hostname)}
        className={`${box} rounded-sm flex-shrink-0 object-contain select-none`}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`${box} rounded-sm flex-shrink-0 flex items-center justify-center font-semibold select-none`}
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
