import { findMemory } from "./memory";
import type { ProjectMemory } from "./memory";

/** Reads project instructions through the guarded bridge. A missing file is null, not an error,
 * since most projects have none. */
export function projectFileReader(workspaceId: string) {
  return async (path: string): Promise<string | null> => {
    const result = await window.electronAPI?.files
      ?.read(workspaceId, path)
      .catch(() => undefined);

    return result?.success ? (result.text ?? "") : null;
  };
}

export function loadProjectMemory(
  workspaceId: string,
  root: string,
  target?: string,
): Promise<ProjectMemory | null> {
  if (!root || !window.electronAPI?.files) return Promise.resolve(null);
  return findMemory(projectFileReader(workspaceId), root, target);
}
