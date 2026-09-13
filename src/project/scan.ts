import { initialMemory } from "./memory";
import type { ProjectScan } from "./memory";
import { safeJsonParse } from "../utils";

/** What `/init` reads: the top of the folder and package.json. Nothing deeper, since a quick draft
 * the user corrects beats a slow one. */
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
