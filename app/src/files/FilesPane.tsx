import FileTree from "./FileTree";
import type { GitStatus } from "../types";

export interface FilesPaneProps {
  workspaceId: string;
  rootPath: string;
  gitStatus?: GitStatus | null;
  selectedFile?: string | null;
  /** Bumped when something on disk changed under the tree. */
  revision?: number;
  t: (key: string) => string;
  onOpenFile?: (path: string) => void;
  onAttachContext?: (path: string) => void;
}

/** The project's files in the dock. The dock's tab is the header, so the tree starts at the top. */
export default function FilesPane({
  workspaceId,
  rootPath,
  gitStatus = null,
  selectedFile = null,
  revision,
  t,
  onOpenFile,
  onAttachContext,
}: FilesPaneProps) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-surface-canvas">
      <FileTree
        workspaceId={workspaceId}
        root={rootPath}
        selected={selectedFile}
        onSelect={(entry) => {
          if (!entry.isDirectory) onOpenFile?.(entry.path);
        }}
        t={t}
        revision={revision}
        gitStatus={gitStatus}
        onAttachContext={onAttachContext}
      />
    </div>
  );
}
