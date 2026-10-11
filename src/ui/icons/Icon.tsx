import { memo } from "react";
import { GLYPHS, type IconName, type IconWeight } from "./glyphs.generated";

export type { IconName, IconWeight };

export interface IconProps {
  name: IconName;
  size?: 16 | 20 | 24 | number;
  filled?: boolean;
  mirrored?: boolean;
  label?: string;
  className?: string;
}

/** Standard icon component delivering whitelisted Phosphor SVG glyphs. */
export const Icon = memo(function Icon({
  name,
  size = 20,
  filled = false,
  mirrored = false,
  label,
  className,
}: IconProps) {
  const weight: IconWeight = filled ? "fill" : size >= 24 ? "light" : "regular";
  const iconData = GLYPHS[name];
  const paths = iconData?.[weight] ?? iconData?.regular ?? [];

  return (
    <svg
      viewBox="0 0 256 256"
      width={size}
      height={size}
      fill="currentColor"
      // Flipped only in RTL text, with the scale property so a rotate class still applies.
      className={mirrored ? `rtl:-scale-x-100 ${className ?? ""}` : className}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": "true" })}
    >
      {paths.map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  );
});
