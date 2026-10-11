import { useState } from "react";
import { Dock } from "../dock/Dock";
import {
  closePane,
  createDefaultDockLayout,
  movePane,
  openPane,
  splitPane,
  unsplit,
  type DockLayout,
  type PaneId,
} from "../../app/dockLayout";
import { translations } from "../../translations";

const t = (key: string) => translations.en[key] || key;

/** Visual verification of tab strip, active panes and vertical split in the component gallery. */
export function DockPreview() {
  const [layout, setLayout] = useState<DockLayout>(() =>
    openPane(createDefaultDockLayout({ file: "src/main.ts", width: 420 }), "plan"),
  );

  return (
    <div className="h-[460px] flex border border-rule rounded-sm overflow-hidden bg-surface-canvas">
      <div className="flex-1 flex items-center justify-center p-4 text-center text-text-secondary text-xs">
        Transcript and messages area beside dock
      </div>
      <Dock
        layout={layout}
        width={layout.width}
        t={t}
        paneTitles={{ plan: "Plan (3/5)", file: "main.ts", diff: "Diff (+12 -2)" }}
        renderPane={(pane, isSplit) => (
          <div className="p-4 text-xs space-y-2">
            <div className="font-medium text-text-primary">
              {pane === "plan" ? "Execution Plan" : pane === "diff" ? "Diff Viewer" : "File Editor: main.ts"}
              {isSplit ? " (Split)" : ""}
            </div>
            <p className="text-text-secondary whitespace-pre font-mono">
              {pane === "plan"
                ? "1. [done] Create dockLayout.ts\n2. [doing] Tab strip and split\n3. [todo] Keyboard navigation"
                : pane === "diff"
                ? "+ import DiffPane from './DiffPane';\n- // old inline diff"
                : "import { Dock } from '../ui/dock/Dock';\nlogRendererEvent('dock', 'INFO', 'dock ready');"}
            </p>
          </div>
        )}
        onSelectPane={(pane: PaneId) => setLayout((prev) => openPane(prev, pane))}
        onClosePane={(pane: PaneId) => setLayout((prev) => closePane(prev, pane))}
        onMovePane={(from, to) => setLayout((prev) => movePane(prev, from, to))}
        onSplitPane={(pane: PaneId) => setLayout((prev) => splitPane(prev, pane))}
        onUnsplit={() => setLayout((prev) => unsplit(prev))}
      />
    </div>
  );
}
