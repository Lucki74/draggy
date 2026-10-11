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
  openPane,
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
  onStartResize: (e: React.MouseEvent) => void;
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
      onLayoutChange(openPane(layout, pane));
    },
    [layout, onLayoutChange],
  );

  const handleClosePane = useCallback(
    (pane: PaneId) => {
      if (pane === "file") onCloseCanvas();
      onLayoutChange(closePane(layout, pane));
    },
    [layout, onLayoutChange, onCloseCanvas],
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
    if (canvasPath) {
      titles.file = baseName(canvasPath);
    }
    return titles;
  }, [canvasPath, t]);

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
      if (pane === "file" && canvasPath) {
        return (
          <Canvas
            key={canvasPath}
            workspaceId={workspaceId}
            path={canvasPath}
            t={t}
            onClose={() => handleClosePane("file")}
            onMoved={onFollowCanvas}
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
