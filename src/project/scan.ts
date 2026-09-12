import { initialMemory } from "./memory";
import type { ProjectScan } from "./memory";
import { safeJsonParse } from "../utils";

/**
 * What `/init` knows about a project: the top of the folder and its
 * package.json if it has one. Nothing deeper, because a first draft the user
 * will read and correct is more useful than a slow one.
 */
export async function scanProject(
  workspaceId: string,
  root: string,
  name: string,
): Promise<ProjectScan> {
  const api = window.electronAPI?.files;

  const listing = await api?.list(workspaceId, ".").catch(() => undefined);

  const entries = (listing?.entries ?? []).map((entry) => ({
    name: entry.name,
    isDirectory: entry.isDirectory,
  }));

  const hasPackage = entries.some((entry) => entry.name === "package.json");

  const read = hasPackage
    ? await api?.read(workspaceId, "package.json").catch(() => undefined)
    : undefined;

  const packageJson = read?.success
    ? safeJsonParse<ProjectScan["packageJson"]>(read.text ?? "")
    : null;

  return { name: name || root, entries, packageJson: packageJson ?? null };
}

export async function draftProjectMemory(
  workspaceId: string,
  root: string,
  name: string,
): Promise<string> {
  return initialMemory(await scanProject(workspaceId, root, name));
}
