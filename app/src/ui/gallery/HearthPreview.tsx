import Logo from "../../Logo";
import { Embers } from "../signature/Embers";
import { HearthGlow } from "../signature/HearthGlow";

/** The Talk hearth at full heat, with a slow swell, for looks and for the R2 frame-cost check. */
export function HearthPreview() {
  const heat = () => 0.55 + 0.4 * Math.sin(performance.now() / 900);
  return (
    <div className="relative flex h-80 w-full max-w-2xl flex-col items-center justify-center overflow-hidden rounded-md border border-rule bg-surface-canvas">
      <Embers heat={heat} className="absolute inset-0 h-full w-full" />
      <Logo className="relative h-24 w-24 text-text-primary" />
      <p className="relative mt-6 text-[14px] text-text-secondary">Listening</p>
      <HearthGlow lit />
    </div>
  );
}
