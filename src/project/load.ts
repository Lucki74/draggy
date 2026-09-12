import { findMemory } from "./memory";
import type { ProjectMemory } from "./memory";

/**
 * Reading the project's instructions through the same guarded bridge as every
 * other file. A file that is not there comes back as null rather than an error,
 * because most projects have no memory file and that is not a problem.
 */
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
