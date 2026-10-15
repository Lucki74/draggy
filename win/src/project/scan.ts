import { initialMemory } from "./memory";
import type { ProjectScan } from "./memory";
import { safeJsonParse } from "../utils";
import { logRendererEvent, swallowed } from "../logger";

/** What `/init` reads: the top of the folder and package.json. Nothing deeper, since a quick draft
 * the user corrects beats a slow one. */
export async function scanProject(
  workspaceId: string,
  root: string,
  name: string,
): Promise<ProjectScan> {
  const api = window.electronAPI?.files;
  const startedAt = performance.now();

  const listing = await api?.list(workspaceId, ".").catch(swallowed("project", "the main process already logged this call"));

  const entries = (listing?.entries ?? []).map((entry) => ({
    name: entry.name,
    isDirectory: entry.isDirectory,
  }));

  const hasPackage = entries.some((entry) => entry.name === "package.json");

  const read = hasPackage
    ? await api?.read(workspaceId, "package.json").catch(swallowed("project", "the main process already logged this call"))
    : undefined;

  const packageJson = read?.success
    ? safeJsonParse<ProjectScan["packageJson"]>(read.text ?? "")
    : null;

  logRendererEvent("renderer.project", "DEBUG", "project scanned", {
    entries: entries.length,
    hasPackageJson: packageJson !== null && packageJson !== undefined,
    durMs: Math.round(performance.now() - startedAt),
  }, null);
  return { name: name || root, entries, packageJson: packageJson ?? null };
}

export async function draftProjectMemory(
  workspaceId: string,
  root: string,
  name: string,
): Promise<string> {
  return initialMemory(await scanProject(workspaceId, root, name));
}
