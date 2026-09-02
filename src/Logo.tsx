import mark from "./assets/dragon.png";

interface LogoProps {
  /** Sizing and colour, e.g. "w-6 h-6 text-[var(--text-main)]". */
  className?: string;
}

/**
 * The dragon, drawn in the colour of the text around it. A flat silhouette used
 * as a mask, so one file serves both themes and every weight.
 */
export default function Logo({ className = "" }: LogoProps) {
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        display: "block",
        backgroundColor: "currentColor",
        maskImage: `url(${mark})`,
        WebkitMaskImage: `url(${mark})`,
        maskSize: "contain",
        WebkitMaskSize: "contain",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskPosition: "center",
        WebkitMaskPosition: "center",
      }}
    />
  );
}
