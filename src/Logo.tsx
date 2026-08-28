import mark from "./assets/dragon.png";

interface LogoProps {
  /** Sizing and colour, e.g. "w-6 h-6 text-[var(--text-main)]". */
  className?: string;
}

/**
 * The dragon, drawn in whatever colour the text around it is.
 *
 * The artwork is a flat silhouette, so it is used as a mask rather than shown
 * as a picture: the colour then comes from `currentColor`. That is what makes
 * it black on the light theme and white on the dark one without two copies of
 * the file to keep in step, and it lets the same mark sit muted in an empty
 * state and full-strength in the sidebar.
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
