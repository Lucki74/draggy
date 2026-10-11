import { useCallback, useEffect, useState } from "react";
import { swallowed } from "../logger";

/** An update that finished downloading, offered once per launch. The install itself is silent, so
 * "Install now" is a restart rather than a wizard. */
export function useUpdateDialog() {
  const [ready, setReady] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!window.electronAPI?.updater) return;

    const updater = window.electronAPI.updater;

    // Already downloaded before this window opened, which is the usual case:
    // the check runs twenty seconds after launch and the download is quiet.
    updater
      .state()
      .then((current) => {
        if (current?.status === "ready") {
          setReady(current.version ?? "");
          setNotes(current.notes ?? null);
        }
      })
      .catch(swallowed("app", "best effort, the screen works without it"));

    return updater.onState((next) => {
      if (next.status === "ready") {
        setReady(next.version ?? "");
        setNotes(next.notes ?? null);
      }
    });
  }, []);

  const dismiss = useCallback(() => setDismissed(true), []);

  return { ready, notes, dismissed, dismiss };
}
