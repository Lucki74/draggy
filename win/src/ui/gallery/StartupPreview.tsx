import { ProgressLine } from "../ProgressLine";
import { EmberMark } from "../signature/EmberMark";
import { Fuse } from "../signature/Fuse";

/** The splash at its real size, loading, and the two progress lines side by side. */
export function StartupPreview() {
  return (
    <div className="flex flex-wrap items-start gap-6">
      <div className="flex h-[500px] w-[400px] flex-col items-center justify-center rounded-md border border-rule bg-surface-canvas px-8">
        <EmberMark />
        <p className="mt-2 text-[14px] leading-5 text-text-secondary">Loading Qwen3 8B</p>
        <div className="mt-4 w-full max-w-[220px]">
          <Fuse label="Loading Qwen3 8B" />
        </div>
      </div>
      <div className="flex w-[220px] flex-col gap-4 pt-6">
        <ProgressLine progress={0.42} label="Download" />
        <ProgressLine label="Download" />
        <Fuse progress={0.6} label="Engine" />
      </div>
    </div>
  );
}
