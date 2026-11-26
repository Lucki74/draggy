import { useEffect, useState } from "react";
import type { GitStatus } from "../types";
import { swallowed } from "../logger";

/** How often the strip checks on its own, between the changes it hears about. */
const REFRESH_MS = 30_000;

/** A burst of writes is one refresh, not one per file. */
const SETTLE_MS = 400;

/** Git status kept current: on open, on any file change in the workspace, on window focus (a
 * terminal commit), and every half minute otherwise, inside a repository. */
export function useGitStatus(workspaceId: string, root: string | null): GitStatus | null {
  const [state, setState] = useState<{ key: string; status: GitStatus } | null>(null);
  const key = `${workspaceId}:${root ?? ""}`;

  useEffect(() => {
    const api = window.draggy?.git;
    if (!api || !root) return;

    let current = true;
    let pending: ReturnType<typeof setTimeout> | undefined;
    let interval: ReturnType<typeof setInterval> | undefined;

    const refresh = () => {
      api
        .status(workspaceId)
        .then((status) => {
          if (!current) return;
          setState({ key, status });
          // Outside a repository the timer only asks again for the same no; a file change or focus still checks.
          if (!status.isRepo) {
            clearInterval(interval);
            interval = undefined;
          } else if (interval === undefined) {
            interval = setInterval(refresh, REFRESH_MS);
          }
        })
        .catch(swallowed("project", "the main process already logged this call"));
    };

    const soon = () => {
      clearTimeout(pending);
      pending = setTimeout(refresh, SETTLE_MS);
    };

    refresh();

    const stopListening = window.draggy?.files?.onChanged?.((change) => {
      if (!change.workspaceId || change.workspaceId === workspaceId) soon();
    });

    window.addEventListener("focus", soon);
    interval = setInterval(refresh, REFRESH_MS);

    return () => {
      current = false;
      clearTimeout(pending);
      clearInterval(interval);
      window.removeEventListener("focus", soon);
      stopListening?.();
    };
  }, [workspaceId, root, key]);

  // A status from the previous workspace is not this one's.
  return state && state.key === key ? state.status : null;
}
