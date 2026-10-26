import React, { useEffect, useState } from "react";
import { Icon, type IconName } from "../icons/Icon";
import { IconButton } from "../IconButton";
import { PaneHeader } from "./PaneHeader";
import type { DockLayout, PaneId } from "../../app/dockLayout";

export interface DockProps {
  layout: DockLayout;
  width: number;
  t: (key: string) => string;
  renderPane: (pane: PaneId, isSplit?: boolean) => React.ReactNode;
  onSelectPane: (pane: PaneId) => void;
  onClosePane: (pane: PaneId) => void;
  onMovePane: (fromIndex: number, toIndex: number) => void;
  onSplitPane?: (pane: PaneId) => void;
  onUnsplit?: () => void;
  onStartResize?: (e: React.PointerEvent) => void;
  paneTitles?: Partial<Record<PaneId, string>>;
  paneIcons?: Partial<Record<PaneId, IconName>>;
  /** Kinds of tab the + button can add, such as the shells installed here. The button shows only with these. */
  newMenu?: Array<{ id: string; label: string }>;
  onNewPane?: (id: string) => void;
  isOverlay?: boolean;
  className?: string;
}

const DEFAULT_PANE_ICONS: Partial<Record<PaneId, IconName>> = {
  plan: "check",
  file: "file-code",
  files: "folder-simple",
  diff: "git-diff",
  browser: "globe-simple",
};

/** Secondary column hosting active implementation plans, diffs, files and canvases. */
export function Dock({
  layout,
  width,
  t,
  renderPane,
  onSelectPane,
  onClosePane,
  onMovePane,
  onSplitPane,
  onUnsplit,
  onStartResize,
  paneTitles = {},
  paneIcons = {},
  newMenu = [],
  onNewPane,
  isOverlay = false,
  className = "",
}: DockProps) {
  const { panes, active, split } = layout;
  const [choosing, setChoosing] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "\\" && active) {
        e.preventDefault();
        onClosePane(active);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active, onClosePane]);



  if (panes.length === 0 || !active) return null;

  const titleOf = (pane: PaneId) => paneTitles[pane] ?? t(pane);
  const iconOf = (pane: PaneId) => paneIcons[pane] ?? DEFAULT_PANE_ICONS[pane] ?? (pane.startsWith("file:") ? "file-code" : pane.startsWith("terminal:") ? "terminal-window" : "file");

  const handleSplitToggle = () => {
    if (split) {
      onUnsplit?.();
    } else {
      const candidate = panes.find((p) => p !== active);
      if (candidate) onSplitPane?.(candidate);
    }
  };

  return (
    <div
      data-region="dock"
      tabIndex={-1}
      className={`${
        isOverlay
          ? "absolute inset-y-0 end-0 z-30 flex shadow-2xl bg-surface-base border-s border-rule"
          : "flex h-full flex-shrink-0 relative"
      } ${className}`}
    >
      {onStartResize && (
        <div
          onPointerDown={onStartResize}
          className="w-1.5 cursor-col-resize hover:bg-rule-strong active:bg-text-secondary flex-shrink-0 select-none z-10 transition-colors"
          title={t("resizePane")}
        />
      )}

      <div
        className="flex flex-col border-s border-rule h-full overflow-hidden bg-surface-canvas"
        style={{ width: `${width}px` }}
      >
        <div className="h-9 px-2 flex items-center justify-between border-b border-rule bg-surface-base select-none flex-shrink-0 gap-1 overflow-x-auto">
          <div
            role="tablist"
            aria-label={t("panes")}
            className="flex items-center gap-1 min-w-0 flex-1 overflow-x-auto no-scrollbar"
          >
            {panes.map((pane, index) => {
              const isActive = pane === active;
              return (
                <div
                  key={pane}
                  role="tab"
                  id={`dock-tab-${pane}`}
                  aria-selected={isActive}
                  aria-controls={`dock-panel-${pane}`}
                  tabIndex={isActive ? 0 : -1}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", String(index));
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = Number(e.dataTransfer.getData("text/plain"));
                    if (!Number.isNaN(from)) onMovePane(from, index);
                  }}
                  onClick={() => onSelectPane(pane)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectPane(pane);
                    } else if (e.key === "ArrowRight") {
                      e.preventDefault();
                      const next = (index + 1) % panes.length;
                      onSelectPane(panes[next]);
                      const tablist = e.currentTarget.parentElement;
                      tablist?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
                    } else if (e.key === "ArrowLeft") {
                      e.preventDefault();
                      const next = (index - 1 + panes.length) % panes.length;
                      onSelectPane(panes[next]);
                      const tablist = e.currentTarget.parentElement;
                      tablist?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
                    } else if (e.key === "Home") {
                      e.preventDefault();
                      onSelectPane(panes[0]);
                      const tablist = e.currentTarget.parentElement;
                      tablist?.querySelectorAll<HTMLElement>('[role="tab"]')[0]?.focus();
                    } else if (e.key === "End") {
                      e.preventDefault();
                      const last = panes.length - 1;
                      onSelectPane(panes[last]);
                      const tablist = e.currentTarget.parentElement;
                      tablist?.querySelectorAll<HTMLElement>('[role="tab"]')[last]?.focus();
                    }
                  }}
                  className={`group h-7 px-2.5 rounded-pill flex items-center gap-1.5 text-[12px] font-medium transition-colors cursor-pointer select-none border outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                    isActive
                      ? "bg-surface-canvas text-text-primary border-rule-control shadow-xs"
                      : "text-text-secondary hover:text-text-primary hover:bg-surface-raised border-transparent"
                  }`}
                >
                  <Icon name={iconOf(pane)} size={14} className="flex-shrink-0" />
                  <span className="truncate max-w-[140px]">{titleOf(pane)}</span>
                  <button
                    type="button"
                    tabIndex={isActive ? 0 : -1}
                    onClick={(e) => {
                      e.stopPropagation();
                      onClosePane(pane);
                    }}
                    aria-label={`${t("closePane")} ${titleOf(pane)}`}
                    className={`p-0.5 rounded-pill hover:bg-surface-raised text-text-secondary hover:text-text-primary transition-opacity focus:opacity-100 group-hover:opacity-100 ${isActive ? "opacity-100" : "opacity-0"}`}
                  >
                    <Icon name="x" size={12} />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-0.5 flex-shrink-0">
            {choosing &&
              newMenu.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="h-6 px-2 rounded-pill text-[12px] text-text-secondary hover:text-text-primary hover:bg-surface-raised"
                  onClick={() => {
                    setChoosing(false);
                    onNewPane?.(entry.id);
                  }}
                >
                  {entry.label}
                </button>
              ))}
            {onNewPane && newMenu.length > 0 && (
              <IconButton name={choosing ? "x" : "plus"} size="dense" label={t("terminalNew")} onClick={() => setChoosing((open) => !open)} />
            )}
            {panes.length > 1 && (
              <IconButton
                name={split ? "arrows-in-simple" : "table"}
                size="dense"
                label={split ? t("unsplitPane") : t("splitPane")}
                onClick={handleSplitToggle}
              />
            )}
          </div>
        </div>

        {split ? (
          <div className="flex-1 flex flex-col min-h-0">
            <div
              role="tabpanel"
              id={`dock-panel-${active}`}
              aria-labelledby={`dock-tab-${active}`}
              className="flex-1 min-h-0 overflow-y-auto"
            >
              {renderPane(active, false)}
            </div>
            <div className="flex-1 min-h-0 flex flex-col border-t border-rule">
              <PaneHeader
                title={titleOf(split)}
                icon={iconOf(split)}
                onClose={() => onUnsplit?.()}
                closeLabel={t("closePane")}
              />
              <div className="flex-1 min-h-0 overflow-y-auto">
                {renderPane(split, true)}
              </div>
            </div>
          </div>
        ) : (
          <div
            role="tabpanel"
            id={`dock-panel-${active}`}
            aria-labelledby={`dock-tab-${active}`}
            className="flex-1 min-h-0 overflow-y-auto"
          >
            {renderPane(active, false)}
          </div>
        )}
      </div>
    </div>
  );
}
