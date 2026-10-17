import React, { useCallback, useMemo } from "react";
import { Dock as UiDock } from "../ui/dock/Dock";
import Canvas from "../canvas/Canvas";
import PlanPanel from "../plan/PlanPanel";
import DiffPane from "../diff/DiffPane";
import FilesPane from "../files/FilesPane";
import BrowserPane from "../browser/BrowserPane";
import StatsPanel from "../stats/StatsPanel";
import { baseName, isInsideRoot, relativePath } from "../files/tree";
import { mentionFile } from "../chat/mentions";
import {
  closePane,
  movePane,
  filePathOf,
  openPane,
  renameFilePane,
  splitPane,
  unsplit,
  type DockLayout,
  type PaneId,
} from "./dockLayout";
import type { PlanItem } from "../plan/plan";
import type { GitStatus } from "../types";

export interface DockProps {
  layout: DockLayout;
  onLayoutChange: (next: DockLayout) => void;
  canvasPath: string | null;
  hasPlan: boolean;
  planItems?: PlanItem[] | null;
  isRunning: boolean;
  width: number;
  workspaceId: string;
  /** The open chat, whose usage the Usage pane shows. */
  chatId?: string | null;
  rootPath?: string | null;
  gitStatus?: GitStatus | null;
  t: (key: string) => string;
  onStartResize: (e: React.PointerEvent) => void;
  onPlanChange: (items: PlanItem[]) => void;
  onContinuePlan: () => void;
  /** Plan mode with a plan written: the plan pane asks the user to proceed or comment. */
  awaitingPlanReview?: boolean;
  onProceedPlan?: () => void;
  onCloseCanvas: () => void;
  onFollowCanvas: (path: string) => void;
  onOpenFile?: (path: string) => void;
  onSendReviewComment?: (prompt: string) => void;
  isOverlay?: boolean;
}

/* Secondary column hosting active implementation plans, files and canvases. */
export function Dock({
  layout,
  onLayoutChange,
  canvasPath,
  hasPlan: _hasPlan,
  planItems,
  isRunning,
  width,
  workspaceId,
  chatId,
  rootPath,
  gitStatus,
  t,
  onStartResize,
  onPlanChange,
  onContinuePlan,
  awaitingPlanReview = false,
  onProceedPlan,
  onCloseCanvas,
  onFollowCanvas,
  onOpenFile,
  onSendReviewComment,
  isOverlay = false,
}: DockProps) {
  const handleSelectPane = useCallback(
    (pane: PaneId) => {
      const path = filePathOf(pane);
      if (path) onOpenFile?.(path);
      onLayoutChange(openPane(layout, pane, path ? { file: path } : undefined));
    },
    [layout, onLayoutChange, onOpenFile],
  );

  const handleClosePane = useCallback(
    (pane: PaneId) => {
      const next = closePane(layout, pane);
      if (filePathOf(pane)) {
        // The file area follows the tab that comes forward; with no file tab left it closes.
        const forward = next.active ? filePathOf(next.active) : null;
        if (forward) onOpenFile?.(forward);
        else if (!next.panes.some((one) => filePathOf(one))) onCloseCanvas();
      }
      onLayoutChange(next);
    },
    [layout, onLayoutChange, onCloseCanvas, onOpenFile],
  );

  const handleMovePane = useCallback(
    (from: number, to: number) => {
      onLayoutChange(movePane(layout, from, to));
    },
    [layout, onLayoutChange],
  );

  const handleSplitPane = useCallback(
    (pane: PaneId) => {
      onLayoutChange(splitPane(layout, pane));
    },
    [layout, onLayoutChange],
  );

  const handleUnsplit = useCallback(() => {
    onLayoutChange(unsplit(layout));
  }, [layout, onLayoutChange]);

  const paneTitles = useMemo(() => {
    const titles: Partial<Record<PaneId, string>> = {
      plan: t("plan"),
      diff: t("diffPane"),
      files: t("projectFiles"),
      browser: t("browser"),
      usage: t("usage"),
    };
    for (const pane of layout.panes) {
      const path = filePathOf(pane);
      if (path) titles[pane] = baseName(path);
    }
    return titles;
  }, [layout.panes, t]);

  const renderPane = useCallback(
    (pane: PaneId, isSplit = false) => {
      if (pane === "plan" && planItems) {
        return (
          <PlanPanel
            items={planItems}
            running={isRunning}
            onChange={onPlanChange}
            onContinue={onContinuePlan}
            awaitingReview={awaitingPlanReview}
            onProceed={onProceedPlan}
            onComment={onSendReviewComment}
            t={t}
            hideHeader={!isSplit}
          />
        );
      }
      if (pane === "files") {
        return (
          <FilesPane
            workspaceId={workspaceId}
            rootPath={rootPath ?? ""}
            gitStatus={gitStatus}
            selectedFile={canvasPath}
            t={t}
            onOpenFile={onOpenFile}
            onAttachContext={(path) =>
              mentionFile(rootPath && isInsideRoot(rootPath, path) ? relativePath(rootPath, path) : path)
            }
          />
        );
      }
      const filePath = filePathOf(pane);
      if (filePath) {
        return (
          <Canvas
            key={filePath}
            workspaceId={workspaceId}
            path={filePath}
            t={t}
            onClose={() => handleClosePane(pane)}
            onMoved={(moved) => {
              onLayoutChange(renameFilePane(layout, filePath, moved));
              if (canvasPath === filePath) onFollowCanvas(moved);
            }}
          />
        );
      }
      if (pane === "diff") {
        return (
          <DiffPane
            workspaceId={workspaceId}
            rootPath={rootPath ?? ""}
            initialFile={layout.diffFile ?? layout.file}
            gitStatus={gitStatus}
            t={t}
            onOpenFile={onOpenFile}
            onSendReviewComment={onSendReviewComment}
            width={width}
          />
        );
      }
      if (pane === "browser") {
        return <BrowserPane t={t} />;
      }
      if (pane === "usage") {
        return (
          <div className="h-full overflow-y-auto p-4">
            <StatsPanel t={t} chatId={chatId ?? null} />
          </div>
        );
      }
      return null;
    },
    [
      planItems,
      isRunning,
      onPlanChange,
      onContinuePlan,
      awaitingPlanReview,
      onProceedPlan,
      t,
      canvasPath,
      layout,
      onLayoutChange,
      workspaceId,
      chatId,
      rootPath,
      gitStatus,
      layout.diffFile,
      layout.file,
      onOpenFile,
      onSendReviewComment,
      width,
      handleClosePane,
      onFollowCanvas,
    ],
  );

  return (
    <UiDock
      layout={layout}
      width={width}
      t={t}
      paneTitles={paneTitles}
      renderPane={renderPane}
      onSelectPane={handleSelectPane}
      onClosePane={handleClosePane}
      onMovePane={handleMovePane}
      onSplitPane={handleSplitPane}
      onUnsplit={handleUnsplit}
      onStartResize={onStartResize}
      isOverlay={isOverlay}
    />
  );
}
