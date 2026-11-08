import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../ui/icons/Icon";
import type { GitCommit, GitRef } from "../types";
import { layoutGraph, type GraphRow } from "./graphLayout";

const ROW = 24;
const LANE = 14;
const PAD = 10;
const MIN_HEIGHT = 80;

const GRAPH_COLORS = [
  "var(--accent)",
  "var(--ok)",
  "var(--warn)",
  "var(--danger)",
  "color-mix(in srgb, var(--accent) 50%, var(--ok))",
  "color-mix(in srgb, var(--danger) 50%, var(--accent))",
];

const colorOf = (lane: number) => GRAPH_COLORS[lane % GRAPH_COLORS.length];
const laneX = (lane: number) => PAD + lane * LANE;

const REF_STYLE: Record<GitRef["kind"], string> = {
  head: "bg-accent-soft border border-accent text-text-primary font-semibold",
  branch: "border border-accent text-accent-text",
  remote: "border border-rule text-text-secondary",
  tag: "border border-warn text-warn",
};

function Lanes({ row, width }: { row: GraphRow; width: number }) {
  return (
    <svg width={width} height={ROW} className="flex-shrink-0" aria-hidden="true">
      {row.lines.map((line, index) => {
        const x1 = laneX(line.fromLane);
        const x2 = laneX(line.toLane);
        const y1 = line.fromY * ROW;
        const y2 = line.toY * ROW;
        const mid = (y1 + y2) / 2;
        const d = x1 === x2 ? `M${x1} ${y1}V${y2}` : `M${x1} ${y1}C${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`;
        return <path key={index} d={d} fill="none" stroke={colorOf(line.color)} strokeWidth={1.5} />;
      })}
      <circle cx={laneX(row.lane)} cy={ROW / 2} r={3.5} fill={colorOf(row.lane)} />
    </svg>
  );
}

interface GitGraphProps {
  workspaceId: string;
  t: (key: string) => string;
  /** Changes when the repository may have moved, so the graph reloads. */
  reloadKey: number;
  selected: string | null;
  onSelect: (commit: GitCommit) => void;
}

/** Every branch's commits drawn as lanes, in a collapsible section at the bottom of Review. */
export function GitGraph({ workspaceId, t, reloadKey, selected, onSelect }: GitGraphProps) {
  const [open, setOpen] = useState(true);
  const [height, setHeight] = useState(220);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<{ y: number; height: number } | null>(null);

  useEffect(() => {
    const git = window.electronAPI?.git;
    if (!git || !open) return;
    let live = true;
    git.log(workspaceId, 200, true).then(
      (res) => {
        if (!live) return;
        if (res?.success) {
          setCommits(res.commits ?? []);
          setError(null);
        } else setError(res?.error || t("gitNoCommits"));
      },
      (err) => live && setError(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      live = false;
    };
  }, [workspaceId, t, reloadKey, open]);

  const rows = useMemo(() => layoutGraph(commits), [commits]);
  const width = PAD * 2 + Math.max(0, Math.max(1, ...rows.map((row) => row.lanes)) - 1) * LANE;

  return (
    <section data-testid="git-graph" className="flex-shrink-0 flex flex-col border-t border-rule bg-surface-base">
      {open && (
        <div
          role="separator"
          aria-orientation="horizontal"
          className="h-1 -mt-0.5 cursor-row-resize hover:bg-accent/40"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { y: event.clientY, height };
          }}
          onPointerMove={(event) => {
            if (!drag.current) return;
            setHeight(Math.max(MIN_HEIGHT, drag.current.height + drag.current.y - event.clientY));
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
        />
      )}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="h-7 px-2 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary hover:text-text-primary"
      >
        <Icon name={open ? "caret-down" : "caret-right"} size={12} />
        {t("gitGraph")}
      </button>
      {open && (
        <div style={{ height }} className="overflow-y-auto overflow-x-hidden text-xs">
          {error ? (
            <div className="p-4 text-center text-text-tertiary">{error}</div>
          ) : commits.length === 0 ? (
            <div className="p-4 text-center text-text-tertiary">{t("gitNoCommits")}</div>
          ) : (
            rows.map((row, index) => {
              const commit = commits[index];
              return (
                <button
                  key={row.hash}
                  type="button"
                  onClick={() => onSelect(commit)}
                  title={`${commit.short} ${commit.subject}\n${commit.author} ${commit.date}`}
                  className={`w-full flex items-center gap-1.5 pe-2 text-start ${
                    selected === commit.hash ? "bg-surface-raised text-text-primary" : "text-text-secondary hover:bg-surface-raised/60"
                  }`}
                  style={{ height: ROW }}
                >
                  <Lanes row={row} width={width} />
                  {commit.refs?.map((ref) => (
                    <span key={ref.name} className={`flex-shrink-0 max-w-32 truncate px-1.5 rounded-pill text-[10px] leading-4 ${REF_STYLE[ref.kind]}`}>
                      {ref.name}
                    </span>
                  ))}
                  <span className="flex-1 min-w-0 truncate text-text-primary">{commit.subject}</span>
                  <span className="flex-shrink-0 text-[11px] text-text-tertiary">{commit.author}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </section>
  );
}
