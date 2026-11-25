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
  /** The first entry stays in view above the counter row, as a research run's card does. */
  pinFirst?: boolean;
  /** The turn is running: the live step reads larger and finished steps step back. */
  running?: boolean;
  t: (key: string) => string;
}

/** A turn's steps on one hairline, a node per step, and only the live node in the accent. */
export function Rail({ entries, focus = false, pinFirst = false, running = false, t }: RailProps) {
  const [showAll, setShowAll] = useState(false);
  const pinned = pinFirst ? 1 : 0;
  const hidden = focus && !showAll ? Math.max(0, entries.length - pinned - FOCUS_KEEP) : 0;
  if (entries.length === 0) return null;
  const gone = (index: number) => index >= pinned && index < pinned + hidden;
  const firstShown = hidden > 0 && !pinFirst ? -1 : 0;
  const lastIndex = entries.length - 1;
  const position = (index: number) =>
    `${index === firstShown ? " rail-first" : ""}${index === lastIndex ? " rail-last" : ""}`;
  const counter = (
    <div key="rail-counter" className={`rail-item k-counter${pinFirst ? "" : " rail-first"}`}>
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
  );

  return (
    <RailContext.Provider value={true}>
      <div className={`rail mb-4${running ? " rail-running" : ""}`} data-testid="work-rail">
        {entries.flatMap((entry, index) => [
          ...(hidden > 0 && index === pinned ? [counter] : []),
          <div
            key={entry.key}
            className={`rail-item k-${entry.kind} is-${entry.state}${position(index)}${gone(index) ? " rail-gone" : ""}`}
            inert={gone(index)}
          >
            <span aria-hidden="true" className="rail-node">
              {entry.state === "failed" && <Icon name="x" size={11} />}
            </span>
            <div className="rail-body">
              <div className="rail-pad">{entry.node}</div>
            </div>
          </div>,
        ])}
      </div>
    </RailContext.Provider>
  );
}
export default Rail;
