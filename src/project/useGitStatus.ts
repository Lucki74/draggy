import { useEffect, useState } from "react";
import type { GitStatus } from "../types";

/** How often the strip checks on its own, between the changes it hears about. */
const REFRESH_MS = 30_000;

/** A burst of writes is one refresh, not one per file. */
const SETTLE_MS = 400;

/**
 * The project's git status, kept current: on opening, whenever a file in the
 * workspace changes, when the window comes back into focus (the user may have
 * committed in a terminal), and every half minute in case nothing else said.
 */
export function useGitStatus(workspaceId: string, root: string | null): GitStatus | null {
  const [state, setState] = useState<{ key: string; status: GitStatus } | null>(null);
  const key = `${workspaceId}:${root ?? ""}`;

  useEffect(() => {
    const api = window.electronAPI?.git;
    if (!api || !root) return;

    let current = true;
    let pending: ReturnType<typeof setTimeout> | undefined;

    const refresh = () => {
      api
        .status(workspaceId)
        .then((status) => {
          if (current) setState({ key, status });
        })
        .catch(() => undefined);
    };

    const soon = () => {
      clearTimeout(pending);
      pending = setTimeout(refresh, SETTLE_MS);
    };

    refresh();

    const stopListening = window.electronAPI?.files?.onChanged?.((change) => {
      if (!change.workspaceId || change.workspaceId === workspaceId) soon();
    });

    window.addEventListener("focus", soon);
    const interval = setInterval(refresh, REFRESH_MS);

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
