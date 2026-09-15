import { useCallback, useState } from "react";
import { FolderOpen } from "lucide-react";
import CreatedFiles from "../CreatedFiles";
import Canvas from "../canvas/Canvas";
import FileTree from "./FileTree";
import { baseName, joinPath, parentOf } from "./tree";
import { useTranslator } from "../i18n";
import type { AppSettings, DirectoryEntry, Workspace } from "../types";

interface ExplorerProps {
  settings: AppSettings;
  workspace: Workspace;
  /** A file picked somewhere else, which this screen should open on. */
  initialPath?: string | null;
}

/** The files screen: a gallery of what Draggy made in a plain chat, a tree and preview in a
 * project. One screen, since "where did that file go" is one question. */
export default function Explorer({
  settings,
  workspace,
  initialPath,
}: ExplorerProps) {
  const t = useTranslator(settings.language);

  if (!workspace.rootPath) return <CreatedFiles settings={settings} />;

  return (
    <ProjectFiles
      // A file chosen elsewhere opens a fresh screen rather than being pushed
      // into the one already showing something else.
      key={`${workspace.id}:${initialPath ?? ""}`}
      workspaceId={workspace.id}
      root={workspace.rootPath}
      initialPath={initialPath ?? null}
      t={t}
    />
  );
}

function ProjectFiles({
  workspaceId,
  root,
  initialPath,
  t,
}: {
  workspaceId: string;
  root: string;
  initialPath: string | null;
  t: (key: string) => string;
}) {
  const [selected, setSelected] = useState<DirectoryEntry | null>(
    initialPath
      ? {
          name: baseName(initialPath),
          path: initialPath,
          isDirectory: false,
          size: 0,
          modified: 0,
        }
      : null,
  );
  const [revision, setRevision] = useState(0);

  const changed = useCallback(() => {
    setRevision((count) => count + 1);
    setSelected(null);
  }, []);

  const rename = useCallback(
    async (name: string) => {
      const api = window.electronAPI?.files;
      if (!api || !selected || !name.trim() || name === selected.name) {
        return;
      }

      const target = joinPath(parentOf(selected.path), name.trim());
      const result = await api.move(workspaceId, selected.path, target);

      if (result?.success) {
        setSelected({
          ...selected,
          path: target,
          name: name.trim(),
        });
        setRevision((count) => count + 1);
      }
    },
    [workspaceId, selected],
  );

  const remove = useCallback(async () => {
    const api = window.electronAPI?.files;
    if (!api || !selected) return;

    const result = await api.remove(workspaceId, selected.path);

    if (result?.success) changed();
  }, [workspaceId, selected, changed]);

  return (
    <div className="flex-1 flex min-h-0 bg-[var(--bg-base)]">
      <div
        className="w-64 flex-shrink-0 overflow-y-auto border-r-[3px]"
        style={{ borderColor: "var(--border-light)" }}
      >
        <FileTree
          workspaceId={workspaceId}
          root={root}
          selected={selected?.path ?? null}
          onSelect={setSelected}
          t={t}
          revision={revision}
        />
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[var(--text-muted)]">
            <FolderOpen className="w-10 h-10 opacity-40" />
            <p className="text-sm font-bold tracking-tight">{t("chooseFile")}</p>
          </div>
        ) : (
          <Canvas
            key={`${workspaceId}:${selected.path}`}
            workspaceId={workspaceId}
            path={selected.path}
            t={t}
            onClose={() => setSelected(null)}
            onMoved={(newPath) => {
              setSelected({ ...selected, path: newPath, name: baseName(newPath) });
              setRevision((count) => count + 1);
            }}
            onRename={rename}
            onDelete={remove}
            allowExternal
          />
        )}
      </div>
    </div>
  );
}

