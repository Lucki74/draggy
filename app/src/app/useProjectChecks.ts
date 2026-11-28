import { useCallback, useEffect, useState } from "react";
import { detectChecks, type CheckCommand, type ManifestFiles } from "../agent/lintLoop";
import type { Workspace } from "../types";
import { logRendererError, logSwallow } from "../logger";

const MANIFESTS = ["package.json", "Cargo.toml", "pyproject.toml"];

export type ChecksStatus = "idle" | "loading" | "ready" | "error";

/** Reads the project's manifests and lists the checks they suggest. Missing files are fine; all reads failing is an error. */
export async function detectProjectChecks(workspaceId: string): Promise<CheckCommand[]> {
  const files: ManifestFiles = {};
  let failed = 0;
  for (const name of MANIFESTS) {
    try {
      const result = await window.draggy?.files?.read(workspaceId, name);
      if (result?.success && typeof result.text === "string") files[name] = result.text;
    } catch (error) {
      logSwallow("app", error, "manifest read failed: counted toward the all-failed check");
      failed += 1;
    }
  }
  if (failed === MANIFESTS.length) throw new Error("Could not read the project files.");
  return detectChecks(files);
}

interface Settled {
  key: string;
  status: "ready" | "error";
  checks: CheckCommand[];
}

/** The checks for one project, re-read when the folder changes or Retry is pressed. */
export function useProjectChecks(project: Workspace | null | undefined) {
  const id = project?.rootPath ? project.id : null;
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const key = id ? `${id}#${attempt}` : null;

  useEffect(() => {
    if (!id || !key) return;
    let live = true;
    detectProjectChecks(id)
      .then((found) => {
        if (live) setSettled({ key, status: "ready", checks: found });
      })
      .catch((error: unknown) => {
        logRendererError("app", "project checks failed to load", error, { workspace: id });
        if (live) setSettled({ key, status: "error", checks: [] });
      });
    return () => {
      live = false;
    };
  }, [id, key]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  if (!key) return { status: "idle" as ChecksStatus, checks: [] as CheckCommand[], retry };
  const current = settled?.key === key ? settled : null;
  return {
    status: (current?.status ?? "loading") as ChecksStatus,
    checks: current?.checks ?? [],
    retry,
  };
}
