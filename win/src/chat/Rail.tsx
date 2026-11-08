import { useState } from "react";
import { Icon } from "../ui";
import { RailContext } from "./railContext";

export type RailState = "live" | "done" | "failed";
export type RailKind = "think" | "step" | "card" | "prose";

export interface RailEntry {
  key: string;
  state: RailState;
  kind: RailKind;
  node: React.ReactNode;
}

// While a turn runs in the normal view, only the newest steps stay on screen.
const FOCUS_KEEP = 3;

interface RailProps {
  entries: RailEntry[];
  /** Hide all but the newest steps behind a counter row. */
  focus?: boolean;
  /** The turn is running: the live step reads larger and finished steps step back. */
  running?: boolean;
  t: (key: string) => string;
}

/** A turn's steps on one hairline, a node per step, and only the live node in the accent. */
export function Rail({ entries, focus = false, running = false, t }: RailProps) {
  const [showAll, setShowAll] = useState(false);
  const hidden = focus && !showAll ? Math.max(0, entries.length - FOCUS_KEEP) : 0;
  if (entries.length === 0) return null;
  const firstShown = hidden > 0 ? -1 : 0;
  const lastIndex = entries.length - 1;
  const position = (index: number) =>
    `${index === firstShown ? " rail-first" : ""}${index === lastIndex ? " rail-last" : ""}`;

  return (
    <RailContext.Provider value={true}>
      <div className={`rail mb-4${running ? " rail-running" : ""}`} data-testid="work-rail">
        {hidden > 0 && (
          <div className="rail-item k-counter rail-first">
            <span aria-hidden="true" className="rail-node" />
            <div className="rail-body">
              <div className="rail-pad">
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="flex min-h-6 items-center rounded-xs px-2 -ms-2 text-[13px] text-text-tertiary hover:bg-surface-raised hover:text-text-secondary"
                >
                  {t(hidden === 1 ? "earlierSteps_one" : "earlierSteps_other").replace("{n}", String(hidden))}
                </button>
              </div>
            </div>
          </div>
        )}
        {entries.map((entry, index) => (
          <div
            key={entry.key}
            className={`rail-item k-${entry.kind} is-${entry.state}${position(index)}${index < hidden ? " rail-gone" : ""}`}
            inert={index < hidden}
          >
            <span aria-hidden="true" className="rail-node">
              {entry.state === "failed" && <Icon name="x" size={11} />}
            </span>
            <div className="rail-body">
              <div className="rail-pad">{entry.node}</div>
            </div>
          </div>
        ))}
      </div>
    </RailContext.Provider>
  );
}
export default Rail;
