import Logo from "../Logo";
import { IconButton } from "../ui/IconButton";
import { Icon } from "../ui/icons/Icon";
import { Menu, type MenuEntry } from "../ui/Menu";
import { Kbd } from "../ui/Kbd";

export type { TranscriptView as TranscriptViewMode } from "../chat/transcriptView";
import type { TranscriptView as TranscriptViewMode } from "../chat/transcriptView";

const VIEW_LABEL = {
  normal: "transcriptNormal",
  thinking: "transcriptThinking",
  verbose: "transcriptVerbose",
} as const;

export interface TitleBarProps {
  t: (key: string) => string;
  projectName?: string;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  /** Changed-file counts from git status, not line counts. */
  diffStats?: { added: number; modified?: number; removed: number } | null;
  onOpenDiff?: () => void;
  onOpenFiles?: () => void;
  onOpenBrowser?: () => void;
  onOpenTerminal?: () => void;
  onOpenPlan?: () => void;
  /** "3 of 7" while a run works through a plan; opens the plan pane. */
  planProgress?: string | null;
  viewMode?: TranscriptViewMode;
  onChangeViewMode?: (mode: TranscriptViewMode) => void;
  className?: string;
}

// Window header containing 16px dragon mark, breadcrumb, diff metrics and views menu.
export function TitleBar({
  t,
  projectName,
  sidebarOpen,
  onToggleSidebar,
  diffStats,
  onOpenDiff,
  onOpenFiles,
  onOpenBrowser,
  onOpenTerminal,
  onOpenPlan,
  planProgress,
  viewMode = "normal",
  onChangeViewMode,
  className = "",
}: TitleBarProps) {

  const hasPanes = Boolean(onOpenFiles || onOpenBrowser || onOpenTerminal || onOpenPlan);
  const viewItems: MenuEntry[] = [];
  if (onChangeViewMode) {
    viewItems.push({
      type: "heading",
      id: "transcript",
      label: (
        <span className="flex items-center justify-between gap-3">
          {t("transcript")}
          <Kbd>Ctrl+O</Kbd>
        </span>
      ),
    });
    for (const mode of ["normal", "thinking", "verbose"] as const) {
      viewItems.push({
        id: mode,
        label: t(VIEW_LABEL[mode]),
        checked: viewMode === mode,
        onSelect: () => onChangeViewMode(mode),
      });
    }
  }
  if (onChangeViewMode && hasPanes) viewItems.push({ type: "separator", id: "sep" });
  if (hasPanes) viewItems.push({ type: "heading", id: "panes", label: t("panes") });
  if (onOpenFiles) viewItems.push({ id: "files", label: t("projectFiles"), shortcut: "Ctrl+Shift+F", onSelect: onOpenFiles });
  if (onOpenDiff) viewItems.push({ id: "diff", label: t("openDiff"), shortcut: "Ctrl+Shift+D", onSelect: onOpenDiff });
  if (onOpenBrowser) viewItems.push({ id: "browser", label: t("browser"), shortcut: "Ctrl+Shift+B", onSelect: onOpenBrowser });
  if (onOpenTerminal) viewItems.push({ id: "terminal", label: t("terminal"), shortcut: "Ctrl+Shift+T", onSelect: onOpenTerminal });
  if (onOpenPlan) viewItems.push({ id: "plan", label: t("plan"), shortcut: "Ctrl+Shift+L", onSelect: onOpenPlan });

  return (
    <header
      className={`drag-region h-10 w-full flex-shrink-0 flex items-center justify-between border-b border-rule bg-surface-canvas text-text-primary select-none ps-3 pe-[140px] ${className}`}
    >
      {/* Left side: dragon mark, sidebar toggle and breadcrumbs */}
      <div className="flex items-center min-w-0 gap-2">
        <div className="w-4 h-4 shrink-0 flex items-center justify-center no-drag">
          <Logo className="w-4 h-4 text-text-primary shrink-0" />
        </div>

        <IconButton
          name="sidebar-simple"
          label={sidebarOpen ? t("hideSidebar") : t("showSidebar")}
          shortcut="Ctrl+B"
          size="dense"
          onClick={onToggleSidebar}
          className="no-drag"
        />

        {/* The project a code session belongs to */}
        <div className="flex items-center min-w-0 max-w-[420px] gap-1.5 text-xs font-medium no-drag">
          {projectName && (
            <>
              <span className="truncate min-w-12 max-w-[130px] text-text-secondary shrink">
                {projectName}
              </span>
            </>
          )}

        </div>
      </div>

      {/* Spacer handles window dragging */}
      <div className="flex-1 h-full min-w-4" />

      {/* Right side: diff indicator and views dropdown menu */}
      <div className="flex items-center gap-2 no-drag">
        {planProgress && (
          <button
            type="button"
            onClick={onOpenPlan}
            aria-label={`${t("plan")}: ${planProgress}`}
            title={t("plan")}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-pill text-[11px] tabular-nums text-text-secondary bg-surface-tint border border-rule hover:bg-surface-raised hover:text-text-primary cursor-pointer transition-colors"
          >
            <Icon name="circle-half" size={12} />
            {planProgress}
          </button>
        )}
        {diffStats && (diffStats.added > 0 || (diffStats.modified ?? 0) > 0 || diffStats.removed > 0) && (
          <button
            onClick={onOpenDiff}
            aria-label={t("openDiff")}
            title={t("openDiff")}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-pill text-[11px] font-mono tabular-nums bg-surface-tint border border-rule hover:bg-surface-raised cursor-pointer transition-colors"
          >
            {diffStats.added > 0 && <span className="text-ok font-semibold">+{diffStats.added}</span>}
            {(diffStats.modified ?? 0) > 0 && (
              <span className="text-text-secondary font-semibold">~{diffStats.modified}</span>
            )}
            {diffStats.removed > 0 && (
              <span className="text-danger font-semibold">{"−"}{diffStats.removed}</span>
            )}
          </button>
        )}

        {(onChangeViewMode || hasPanes) && (
          <Menu
            label={t("views")}
            align="end"
            items={viewItems}
            trigger={(props) => (
              <button
                type="button"
                {...props}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-pill text-[12px] font-medium text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors cursor-pointer"
              >
                <span>{t("views")}</span>
                <Icon name="caret-down" size={16} />
              </button>
            )}
          />
        )}
      </div>
    </header>
  );
}
export default TitleBar;
