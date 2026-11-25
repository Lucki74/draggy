import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Logo from "../Logo";
import { translations } from "../translations";
import { Button } from "../ui/Button";
import { ProgressLine } from "../ui/ProgressLine";
import { Fuse } from "../ui/signature/Fuse";
import { INITIAL_STATE, splashView, type SplashState } from "./splashView";

function call(channel: string) {
  return invoke<unknown>("ipc_invoke", { channel, args: [] });
}

/** silent-ok: the app's logger sends through the main window's channel, which the splash may not use,
 * and the shell logs the startup itself. A failed call leaves the splash on its last state until the
 * shell swaps it for the main window. */
const warn = (): undefined => undefined;

/** The startup window: the dragon, one status line, and a line under it. During a download the user
 * can start without updating; the app offers the same update later. */
export default function SplashScreen({ language }: { language: string }) {
  const t = useCallback(
    (key: string) => translations[language]?.[key] || translations.en[key] || key,
    [language],
  );
  const [state, setState] = useState<SplashState>(INITIAL_STATE);

  useEffect(() => {
    let live = true;
    const stop = listen<SplashState>("splash-state", (event) => setState(event.payload));
    // Listening first, then asking, so a change between the two is not lost.
    void stop
      .then(() => call("splash:state"))
      .then((now) => {
        if (live && now) setState(now as SplashState);
      })
      .catch(warn);
    return () => {
      live = false;
      void stop.then((unlisten) => unlisten()).catch(warn);
    };
  }, []);

  const view = splashView(state, t, language);

  return (
    <div
      data-tauri-drag-region
      className="flex h-screen w-full select-none flex-col overflow-hidden bg-surface-canvas text-text-primary"
    >
      <main data-tauri-drag-region className="flex min-h-0 flex-1 flex-col items-center justify-center px-8">
        <span aria-hidden className="h-24 w-24">
          <Logo className="h-full w-full text-text-primary" />
        </span>
        <p role="status" aria-live="polite" className="mt-6 min-h-5 text-center text-[14px] leading-5 text-text-secondary">
          {view.status}
        </p>
        <div data-tauri-drag-region className="mt-4 min-h-[26px] w-[220px]">
          {view.download ? (
            <>
              <ProgressLine progress={view.download.progress} label={view.status} />
              <p className="mt-2 flex justify-between gap-3 text-[12px] leading-4 text-text-tertiary">
                <span className="min-w-0 truncate">{view.download.version}</span>
                <span className="flex-shrink-0 tabular-nums">{view.download.transferred}</span>
              </p>
            </>
          ) : (
            <Fuse label={view.status} />
          )}
        </div>
      </main>
      <footer data-tauri-drag-region className="flex h-14 items-start justify-center">
        {view.canSkip && (
          <Button variant="ghost" size="dense" onClick={() => void call("splash:skip").catch(warn)}>
            {t("splashSkip")}
          </Button>
        )}
      </footer>
    </div>
  );
}
