import { draggyUrl } from "../appUrl";
import { useState } from "react";
import { Icon } from "../ui";
import { iconMissing, markIconMissing } from "../favicon";

// The site's own icon, fetched by the app; the web glyph when the site has none.
export function SiteBadge({ hostname, small = false }: { hostname: string; small?: boolean }) {
  const box = small ? "size-4" : "w-5 h-5 mt-0.5";

  // Tracks host errors so reused rows retry instead of sticking to missing icons.
  const [failedFor, setFailedFor] = useState<string | null>(null);

  if (hostname && failedFor !== hostname && !iconMissing(hostname)) {
    return (
      <img
        src={draggyUrl(`favicon/${encodeURIComponent(hostname)}`)}
        alt=""
        aria-hidden="true"
        loading="lazy"
        onError={() => {
          markIconMissing(hostname);
          setFailedFor(hostname);
        }}
        className={`${box} rounded-sm flex-shrink-0 object-contain select-none`}
      />
    );
  }

  // A site with no icon of its own gets the web glyph, never a made-up letter.
  return (
    <span
      aria-hidden="true"
      className={`${box} rounded-sm flex-shrink-0 flex items-center justify-center bg-surface-tint text-text-tertiary select-none`}
    >
      <Icon name="globe-simple" size={small ? 11 : 13} />
    </span>
  );
}
export default SiteBadge;
